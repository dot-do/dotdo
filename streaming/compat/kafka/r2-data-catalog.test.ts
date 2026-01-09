/**
 * @dotdo/kafka - R2 Data Catalog client tests (RED - No Implementation)
 *
 * FAILING tests for R2DataCatalog - a REST Catalog API client for
 * Cloudflare's R2 Data Catalog managed Iceberg metadata.
 *
 * R2 Data Catalog provides:
 * - Managed Iceberg metadata stored in R2
 * - REST Catalog API for external tool access (Spark, Snowflake, DuckDB)
 * - Standard Iceberg REST Catalog protocol
 *
 * Import from non-existent module so tests fail until implementation exists.
 *
 * @see https://developers.cloudflare.com/r2/data-catalog/
 * @see https://iceberg.apache.org/spec/#iceberg-rest-catalog
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Import from non-existent module - WILL FAIL
import {
  R2DataCatalog,
  createR2DataCatalog,
  // Types
  R2DataCatalogConfig,
  CatalogConfig,
  Namespace,
  NamespaceProperties,
  TableIdentifier,
  TableMetadata,
  IcebergSchema,
  IcebergPartitionSpec,
  PartitionField,
  TableCommitRequest,
  // External tool config types
  SparkCatalogConfig,
  DuckDBCatalogConfig,
  SnowflakeCatalogConfig,
  // Credential types
  VendedCredentials,
  S3Credentials,
  // Error types
  R2CatalogError,
  NamespaceNotFoundError,
  NamespaceAlreadyExistsError,
  TableNotFoundError,
  TableAlreadyExistsError,
  CommitFailedError,
  CommitStateUnknownError,
  ValidationError,
} from './r2-data-catalog'

// ============================================================================
// R2 DATA CATALOG CLIENT TESTS
// ============================================================================

describe('R2DataCatalog client', () => {
  it('should create client with config', () => {
    const catalog = new R2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'test-catalog',
      apiToken: 'test-token',
    })
    expect(catalog).toBeDefined()
  })

  it('should create client with createR2DataCatalog()', () => {
    const catalog = createR2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'test-catalog',
      apiToken: 'test-token',
    })
    expect(catalog).toBeDefined()
  })

  it('should create client with custom endpoint', () => {
    const catalog = new R2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'test-catalog',
      apiToken: 'test-token',
      endpoint: 'https://custom-catalog.example.com',
    })
    expect(catalog).toBeDefined()
  })

  it('should create client with warehouse config', () => {
    const catalog = new R2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'test-catalog',
      apiToken: 'test-token',
      warehouse: 'my-warehouse',
    })
    expect(catalog).toBeDefined()
  })

  it('should validate required config fields', () => {
    expect(() => new R2DataCatalog({} as R2DataCatalogConfig)).toThrow(ValidationError)
    expect(() =>
      new R2DataCatalog({
        accountId: 'test',
        // missing bucketName, catalogName, apiToken
      } as R2DataCatalogConfig)
    ).toThrow(ValidationError)
  })

  it('should get catalog name', () => {
    const catalog = new R2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'my-catalog',
      apiToken: 'test-token',
    })
    expect(catalog.name).toBe('my-catalog')
  })
})

// ============================================================================
// CATALOG CONFIG TESTS (GET /v1/config)
// ============================================================================

describe('R2DataCatalog.getCatalogConfig()', () => {
  let catalog: R2DataCatalog

  beforeEach(() => {
    catalog = new R2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'test-catalog',
      apiToken: 'test-token',
    })
  })

  it('should fetch catalog configuration', async () => {
    const config = await catalog.getCatalogConfig()

    expect(config).toBeDefined()
    expect(config.defaults).toBeDefined()
    expect(config.overrides).toBeDefined()
  })

  it('should return default properties', async () => {
    const config = await catalog.getCatalogConfig()

    // Iceberg REST Catalog defaults
    expect(config.defaults).toHaveProperty('clients.assume-role.external-id')
    expect(config.defaults).toHaveProperty('clients.assume-role.region')
  })

  it('should return override properties', async () => {
    const config = await catalog.getCatalogConfig()

    // Server-enforced properties that override client settings
    expect(config.overrides).toBeDefined()
  })

  it('should include endpoint information', async () => {
    const config = await catalog.getCatalogConfig()

    expect(config.endpoints).toBeDefined()
    expect(config.endpoints?.credentials).toBe(true) // R2 supports vended credentials
  })
})

// ============================================================================
// NAMESPACE MANAGEMENT TESTS
// ============================================================================

describe('Namespace management', () => {
  let catalog: R2DataCatalog

  beforeEach(() => {
    catalog = new R2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'test-catalog',
      apiToken: 'test-token',
    })
  })

  describe('createNamespace', () => {
    it('should create namespace with name only', async () => {
      const namespace = await catalog.createNamespace('analytics')

      expect(namespace.name).toEqual(['analytics'])
      expect(namespace.properties).toBeDefined()
    })

    it('should create nested namespace', async () => {
      const namespace = await catalog.createNamespace(['db', 'analytics', 'events'])

      expect(namespace.name).toEqual(['db', 'analytics', 'events'])
    })

    it('should create namespace with properties', async () => {
      const namespace = await catalog.createNamespace('analytics', {
        owner: 'data-team',
        description: 'Analytics data warehouse',
        location: 's3://my-bucket/analytics/',
      })

      expect(namespace.properties?.owner).toBe('data-team')
      expect(namespace.properties?.description).toBe('Analytics data warehouse')
    })

    it('should throw NamespaceAlreadyExistsError if namespace exists', async () => {
      await catalog.createNamespace('existing')

      await expect(catalog.createNamespace('existing')).rejects.toThrow(NamespaceAlreadyExistsError)
    })

    it('should create namespace if not exists', async () => {
      const namespace1 = await catalog.createNamespaceIfNotExists('new-ns')
      const namespace2 = await catalog.createNamespaceIfNotExists('new-ns')

      expect(namespace1.name).toEqual(['new-ns'])
      expect(namespace2.name).toEqual(['new-ns'])
    })
  })

  describe('listNamespaces', () => {
    it('should list all top-level namespaces', async () => {
      await catalog.createNamespace('ns1')
      await catalog.createNamespace('ns2')
      await catalog.createNamespace('ns3')

      const namespaces = await catalog.listNamespaces()

      expect(namespaces).toContainEqual(['ns1'])
      expect(namespaces).toContainEqual(['ns2'])
      expect(namespaces).toContainEqual(['ns3'])
    })

    it('should list namespaces with parent filter', async () => {
      await catalog.createNamespace(['parent', 'child1'])
      await catalog.createNamespace(['parent', 'child2'])
      await catalog.createNamespace(['other', 'child'])

      const namespaces = await catalog.listNamespaces({ parent: ['parent'] })

      expect(namespaces).toContainEqual(['parent', 'child1'])
      expect(namespaces).toContainEqual(['parent', 'child2'])
      expect(namespaces).not.toContainEqual(['other', 'child'])
    })

    it('should return empty array for empty catalog', async () => {
      const namespaces = await catalog.listNamespaces()

      expect(namespaces).toEqual([])
    })

    it('should support pagination', async () => {
      // Create many namespaces
      for (let i = 0; i < 100; i++) {
        await catalog.createNamespace(`ns-${i}`)
      }

      const page1 = await catalog.listNamespaces({ pageSize: 10 })
      expect(page1.length).toBe(10)

      const page2 = await catalog.listNamespaces({ pageSize: 10, pageToken: page1.nextPageToken })
      expect(page2.length).toBe(10)
    })
  })

  describe('loadNamespace', () => {
    it('should load namespace metadata', async () => {
      await catalog.createNamespace('analytics', {
        owner: 'data-team',
        description: 'Analytics warehouse',
      })

      const namespace = await catalog.loadNamespace('analytics')

      expect(namespace.name).toEqual(['analytics'])
      expect(namespace.properties?.owner).toBe('data-team')
    })

    it('should load nested namespace', async () => {
      await catalog.createNamespace(['db', 'analytics'])

      const namespace = await catalog.loadNamespace(['db', 'analytics'])

      expect(namespace.name).toEqual(['db', 'analytics'])
    })

    it('should throw NamespaceNotFoundError for missing namespace', async () => {
      await expect(catalog.loadNamespace('nonexistent')).rejects.toThrow(NamespaceNotFoundError)
    })
  })

  describe('namespaceExists', () => {
    it('should return true for existing namespace', async () => {
      await catalog.createNamespace('exists')

      const exists = await catalog.namespaceExists('exists')

      expect(exists).toBe(true)
    })

    it('should return false for non-existing namespace', async () => {
      const exists = await catalog.namespaceExists('not-exists')

      expect(exists).toBe(false)
    })
  })

  describe('dropNamespace', () => {
    it('should drop empty namespace', async () => {
      await catalog.createNamespace('to-drop')

      await catalog.dropNamespace('to-drop')

      const exists = await catalog.namespaceExists('to-drop')
      expect(exists).toBe(false)
    })

    it('should throw error when dropping non-empty namespace', async () => {
      await catalog.createNamespace('non-empty')
      await catalog.createTable('non-empty', 'my-table', {
        type: 'struct',
        fields: [{ id: 1, name: 'id', type: 'long', required: true }],
      })

      await expect(catalog.dropNamespace('non-empty')).rejects.toThrow(R2CatalogError)
    })

    it('should throw NamespaceNotFoundError for missing namespace', async () => {
      await expect(catalog.dropNamespace('nonexistent')).rejects.toThrow(NamespaceNotFoundError)
    })
  })

  describe('updateNamespaceProperties', () => {
    it('should update namespace properties', async () => {
      await catalog.createNamespace('props-test', { key1: 'value1' })

      const updated = await catalog.updateNamespaceProperties('props-test', {
        updates: { key2: 'value2' },
      })

      expect(updated.properties?.key1).toBe('value1')
      expect(updated.properties?.key2).toBe('value2')
    })

    it('should remove namespace properties', async () => {
      await catalog.createNamespace('props-test', {
        keep: 'value',
        remove: 'value',
      })

      const updated = await catalog.updateNamespaceProperties('props-test', {
        removals: ['remove'],
      })

      expect(updated.properties?.keep).toBe('value')
      expect(updated.properties?.remove).toBeUndefined()
    })

    it('should update and remove in single operation', async () => {
      await catalog.createNamespace('props-test', {
        a: '1',
        b: '2',
        c: '3',
      })

      const updated = await catalog.updateNamespaceProperties('props-test', {
        updates: { d: '4' },
        removals: ['b'],
      })

      expect(updated.properties?.a).toBe('1')
      expect(updated.properties?.b).toBeUndefined()
      expect(updated.properties?.c).toBe('3')
      expect(updated.properties?.d).toBe('4')
    })
  })
})

// ============================================================================
// TABLE MANAGEMENT TESTS
// ============================================================================

describe('Table management', () => {
  let catalog: R2DataCatalog

  beforeEach(async () => {
    catalog = new R2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'test-catalog',
      apiToken: 'test-token',
    })
    await catalog.createNamespaceIfNotExists('default')
  })

  describe('createTable', () => {
    it('should create table with schema', async () => {
      const table = await catalog.createTable('default', 'users', {
        type: 'struct',
        fields: [
          { id: 1, name: 'id', type: 'long', required: true },
          { id: 2, name: 'name', type: 'string', required: true },
          { id: 3, name: 'email', type: 'string', required: false },
          { id: 4, name: 'created_at', type: 'timestamp', required: true },
        ],
      })

      expect(table.tableUuid).toBeDefined()
      expect(table.location).toBeDefined()
      expect(table.schema.fields).toHaveLength(4)
    })

    it('should create table with partition spec', async () => {
      const table = await catalog.createTable(
        'default',
        'events',
        {
          type: 'struct',
          fields: [
            { id: 1, name: 'event_id', type: 'string', required: true },
            { id: 2, name: 'event_time', type: 'timestamp', required: true },
            { id: 3, name: 'user_id', type: 'string', required: true },
            { id: 4, name: 'data', type: 'string', required: false },
          ],
        },
        {
          fields: [
            { sourceId: 2, fieldId: 1000, name: 'event_hour', transform: 'hour' },
            { sourceId: 3, fieldId: 1001, name: 'user_bucket', transform: 'bucket[16]' },
          ],
        }
      )

      expect(table.partitionSpec.fields).toHaveLength(2)
      expect(table.partitionSpec.fields[0].transform).toBe('hour')
      expect(table.partitionSpec.fields[1].transform).toBe('bucket[16]')
    })

    it('should create table with properties', async () => {
      const table = await catalog.createTable(
        'default',
        'configured',
        {
          type: 'struct',
          fields: [{ id: 1, name: 'id', type: 'long', required: true }],
        },
        undefined,
        {
          'write.format.default': 'parquet',
          'write.parquet.compression-codec': 'zstd',
          'write.metadata.compression-codec': 'gzip',
        }
      )

      expect(table.properties?.['write.format.default']).toBe('parquet')
      expect(table.properties?.['write.parquet.compression-codec']).toBe('zstd')
    })

    it('should create table with sort order', async () => {
      const table = await catalog.createTable(
        'default',
        'sorted',
        {
          type: 'struct',
          fields: [
            { id: 1, name: 'id', type: 'long', required: true },
            { id: 2, name: 'timestamp', type: 'timestamp', required: true },
          ],
        },
        undefined,
        undefined,
        {
          orderId: 1,
          fields: [{ sourceId: 2, transform: 'identity', direction: 'desc', nullOrder: 'nulls-last' }],
        }
      )

      expect(table.sortOrder).toBeDefined()
      expect(table.sortOrder?.fields[0].direction).toBe('desc')
    })

    it('should throw TableAlreadyExistsError if table exists', async () => {
      await catalog.createTable('default', 'existing', {
        type: 'struct',
        fields: [{ id: 1, name: 'id', type: 'long', required: true }],
      })

      await expect(
        catalog.createTable('default', 'existing', {
          type: 'struct',
          fields: [{ id: 1, name: 'id', type: 'long', required: true }],
        })
      ).rejects.toThrow(TableAlreadyExistsError)
    })

    it('should throw NamespaceNotFoundError for missing namespace', async () => {
      await expect(
        catalog.createTable('nonexistent', 'table', {
          type: 'struct',
          fields: [{ id: 1, name: 'id', type: 'long', required: true }],
        })
      ).rejects.toThrow(NamespaceNotFoundError)
    })
  })

  describe('loadTable', () => {
    beforeEach(async () => {
      await catalog.createTable('default', 'my-table', {
        type: 'struct',
        fields: [
          { id: 1, name: 'id', type: 'long', required: true },
          { id: 2, name: 'data', type: 'string', required: false },
        ],
      })
    })

    it('should load table metadata', async () => {
      const table = await catalog.loadTable('default', 'my-table')

      expect(table.tableUuid).toBeDefined()
      expect(table.schema.fields).toHaveLength(2)
      expect(table.schema.fields[0].name).toBe('id')
    })

    it('should include current snapshot', async () => {
      const table = await catalog.loadTable('default', 'my-table')

      // New table might not have snapshots
      expect(table.currentSnapshotId).toBeDefined()
      if (table.currentSnapshotId !== null) {
        expect(table.snapshots).toBeDefined()
      }
    })

    it('should throw TableNotFoundError for missing table', async () => {
      await expect(catalog.loadTable('default', 'nonexistent')).rejects.toThrow(TableNotFoundError)
    })

    it('should load table by TableIdentifier', async () => {
      const table = await catalog.loadTable({ namespace: ['default'], name: 'my-table' })

      expect(table.tableUuid).toBeDefined()
    })

    it('should load table at specific snapshot', async () => {
      // First, create some data to have snapshots
      const table = await catalog.loadTable('default', 'my-table')
      const snapshotId = table.currentSnapshotId

      if (snapshotId !== null) {
        const historicTable = await catalog.loadTable('default', 'my-table', { snapshotId })
        expect(historicTable.currentSnapshotId).toBe(snapshotId)
      }
    })
  })

  describe('tableExists', () => {
    it('should return true for existing table', async () => {
      await catalog.createTable('default', 'exists', {
        type: 'struct',
        fields: [{ id: 1, name: 'id', type: 'long', required: true }],
      })

      const exists = await catalog.tableExists('default', 'exists')

      expect(exists).toBe(true)
    })

    it('should return false for non-existing table', async () => {
      const exists = await catalog.tableExists('default', 'not-exists')

      expect(exists).toBe(false)
    })
  })

  describe('listTables', () => {
    beforeEach(async () => {
      await catalog.createTable('default', 'table1', {
        type: 'struct',
        fields: [{ id: 1, name: 'id', type: 'long', required: true }],
      })
      await catalog.createTable('default', 'table2', {
        type: 'struct',
        fields: [{ id: 1, name: 'id', type: 'long', required: true }],
      })
    })

    it('should list all tables in namespace', async () => {
      const tables = await catalog.listTables('default')

      expect(tables).toContainEqual({ namespace: ['default'], name: 'table1' })
      expect(tables).toContainEqual({ namespace: ['default'], name: 'table2' })
    })

    it('should return empty array for empty namespace', async () => {
      await catalog.createNamespace('empty')

      const tables = await catalog.listTables('empty')

      expect(tables).toEqual([])
    })

    it('should throw NamespaceNotFoundError for missing namespace', async () => {
      await expect(catalog.listTables('nonexistent')).rejects.toThrow(NamespaceNotFoundError)
    })
  })

  describe('dropTable', () => {
    beforeEach(async () => {
      await catalog.createTable('default', 'to-drop', {
        type: 'struct',
        fields: [{ id: 1, name: 'id', type: 'long', required: true }],
      })
    })

    it('should drop table', async () => {
      await catalog.dropTable('default', 'to-drop')

      const exists = await catalog.tableExists('default', 'to-drop')
      expect(exists).toBe(false)
    })

    it('should purge table data when requested', async () => {
      await catalog.dropTable('default', 'to-drop', { purge: true })

      const exists = await catalog.tableExists('default', 'to-drop')
      expect(exists).toBe(false)
    })

    it('should throw TableNotFoundError for missing table', async () => {
      await expect(catalog.dropTable('default', 'nonexistent')).rejects.toThrow(TableNotFoundError)
    })
  })

  describe('renameTable', () => {
    beforeEach(async () => {
      await catalog.createTable('default', 'old-name', {
        type: 'struct',
        fields: [{ id: 1, name: 'id', type: 'long', required: true }],
      })
    })

    it('should rename table within same namespace', async () => {
      await catalog.renameTable({ namespace: ['default'], name: 'old-name' }, { namespace: ['default'], name: 'new-name' })

      const oldExists = await catalog.tableExists('default', 'old-name')
      const newExists = await catalog.tableExists('default', 'new-name')

      expect(oldExists).toBe(false)
      expect(newExists).toBe(true)
    })

    it('should move table to different namespace', async () => {
      await catalog.createNamespace('other')

      await catalog.renameTable({ namespace: ['default'], name: 'old-name' }, { namespace: ['other'], name: 'moved-table' })

      const oldExists = await catalog.tableExists('default', 'old-name')
      const newExists = await catalog.tableExists('other', 'moved-table')

      expect(oldExists).toBe(false)
      expect(newExists).toBe(true)
    })

    it('should throw TableNotFoundError for missing source', async () => {
      await expect(
        catalog.renameTable({ namespace: ['default'], name: 'nonexistent' }, { namespace: ['default'], name: 'new' })
      ).rejects.toThrow(TableNotFoundError)
    })

    it('should throw TableAlreadyExistsError if target exists', async () => {
      await catalog.createTable('default', 'target', {
        type: 'struct',
        fields: [{ id: 1, name: 'id', type: 'long', required: true }],
      })

      await expect(
        catalog.renameTable({ namespace: ['default'], name: 'old-name' }, { namespace: ['default'], name: 'target' })
      ).rejects.toThrow(TableAlreadyExistsError)
    })
  })
})

// ============================================================================
// TABLE COMMIT TESTS
// ============================================================================

describe('Table commits', () => {
  let catalog: R2DataCatalog

  beforeEach(async () => {
    catalog = new R2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'test-catalog',
      apiToken: 'test-token',
    })
    await catalog.createNamespaceIfNotExists('default')
    await catalog.createTable('default', 'commit-test', {
      type: 'struct',
      fields: [
        { id: 1, name: 'id', type: 'long', required: true },
        { id: 2, name: 'name', type: 'string', required: false },
      ],
    })
  })

  it('should commit schema update', async () => {
    const table = await catalog.loadTable('default', 'commit-test')

    const updated = await catalog.commitTable('default', 'commit-test', {
      identifier: { namespace: ['default'], name: 'commit-test' },
      requirements: [
        { type: 'assert-current-schema-id', currentSchemaId: table.currentSchemaId },
      ],
      updates: [
        {
          action: 'add-schema',
          schema: {
            type: 'struct',
            schemaId: table.currentSchemaId + 1,
            fields: [
              ...table.schema.fields,
              { id: 3, name: 'email', type: 'string', required: false },
            ],
          },
        },
        {
          action: 'set-current-schema',
          schemaId: table.currentSchemaId + 1,
        },
      ],
    })

    expect(updated.schema.fields).toHaveLength(3)
    expect(updated.schema.fields[2].name).toBe('email')
  })

  it('should commit partition spec update', async () => {
    const table = await catalog.loadTable('default', 'commit-test')

    const updated = await catalog.commitTable('default', 'commit-test', {
      identifier: { namespace: ['default'], name: 'commit-test' },
      requirements: [
        { type: 'assert-default-spec-id', defaultSpecId: table.defaultSpecId },
      ],
      updates: [
        {
          action: 'add-partition-spec',
          spec: {
            specId: table.defaultSpecId + 1,
            fields: [{ sourceId: 1, fieldId: 1000, name: 'id_bucket', transform: 'bucket[8]' }],
          },
        },
        {
          action: 'set-default-spec',
          specId: table.defaultSpecId + 1,
        },
      ],
    })

    expect(updated.partitionSpec.fields).toHaveLength(1)
  })

  it('should commit snapshot with appended files', async () => {
    const table = await catalog.loadTable('default', 'commit-test')

    const updated = await catalog.commitTable('default', 'commit-test', {
      identifier: { namespace: ['default'], name: 'commit-test' },
      requirements: [
        { type: 'assert-ref-snapshot-id', ref: 'main', snapshotId: table.currentSnapshotId },
      ],
      updates: [
        {
          action: 'add-snapshot',
          snapshot: {
            snapshotId: 1234567890,
            timestampMs: Date.now(),
            manifestList: 's3://test-bucket/metadata/snap-1234567890.avro',
            summary: { operation: 'append' },
          },
        },
        {
          action: 'set-snapshot-ref',
          refName: 'main',
          type: 'branch',
          snapshotId: 1234567890,
        },
      ],
    })

    expect(updated.currentSnapshotId).toBe(1234567890)
  })

  it('should throw CommitFailedError on conflict', async () => {
    // Simulate concurrent modification
    const table = await catalog.loadTable('default', 'commit-test')

    // First commit succeeds
    await catalog.commitTable('default', 'commit-test', {
      identifier: { namespace: ['default'], name: 'commit-test' },
      requirements: [
        { type: 'assert-current-schema-id', currentSchemaId: table.currentSchemaId },
      ],
      updates: [
        {
          action: 'set-properties',
          updates: { 'test-prop': 'value1' },
        },
      ],
    })

    // Second commit with stale requirements fails
    await expect(
      catalog.commitTable('default', 'commit-test', {
        identifier: { namespace: ['default'], name: 'commit-test' },
        requirements: [
          { type: 'assert-current-schema-id', currentSchemaId: table.currentSchemaId - 1 },
        ],
        updates: [
          {
            action: 'set-properties',
            updates: { 'test-prop': 'value2' },
          },
        ],
      })
    ).rejects.toThrow(CommitFailedError)
  })

  it('should commit property updates', async () => {
    const updated = await catalog.commitTable('default', 'commit-test', {
      identifier: { namespace: ['default'], name: 'commit-test' },
      requirements: [],
      updates: [
        {
          action: 'set-properties',
          updates: {
            'custom.property1': 'value1',
            'custom.property2': 'value2',
          },
        },
      ],
    })

    expect(updated.properties?.['custom.property1']).toBe('value1')
  })

  it('should remove properties', async () => {
    // First set properties
    await catalog.commitTable('default', 'commit-test', {
      identifier: { namespace: ['default'], name: 'commit-test' },
      requirements: [],
      updates: [
        {
          action: 'set-properties',
          updates: { 'to-remove': 'value' },
        },
      ],
    })

    // Then remove
    const updated = await catalog.commitTable('default', 'commit-test', {
      identifier: { namespace: ['default'], name: 'commit-test' },
      requirements: [],
      updates: [
        {
          action: 'remove-properties',
          removals: ['to-remove'],
        },
      ],
    })

    expect(updated.properties?.['to-remove']).toBeUndefined()
  })
})

// ============================================================================
// VENDED CREDENTIALS TESTS
// ============================================================================

describe('Vended credentials', () => {
  let catalog: R2DataCatalog

  beforeEach(async () => {
    catalog = new R2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'test-catalog',
      apiToken: 'test-token',
    })
    await catalog.createNamespaceIfNotExists('default')
    await catalog.createTable('default', 'creds-test', {
      type: 'struct',
      fields: [{ id: 1, name: 'id', type: 'long', required: true }],
    })
  })

  it('should get S3-compatible credentials for table', async () => {
    const creds = await catalog.getCredentials('default', 'creds-test')

    expect(creds).toBeDefined()
    expect(creds.accessKeyId).toBeDefined()
    expect(creds.secretAccessKey).toBeDefined()
    expect(creds.sessionToken).toBeDefined()
  })

  it('should include R2 endpoint in credentials', async () => {
    const creds = await catalog.getCredentials('default', 'creds-test')

    expect(creds.endpoint).toBeDefined()
    expect(creds.endpoint).toContain('r2.cloudflarestorage.com')
  })

  it('should include expiration time', async () => {
    const creds = await catalog.getCredentials('default', 'creds-test')

    expect(creds.expiration).toBeDefined()
    expect(new Date(creds.expiration).getTime()).toBeGreaterThan(Date.now())
  })

  it('should scope credentials to table location', async () => {
    const creds = await catalog.getCredentials('default', 'creds-test')

    expect(creds.prefix).toBeDefined()
    // Credentials should be scoped to the table's location
  })
})

// ============================================================================
// EXTERNAL TOOL CONFIGURATION TESTS
// ============================================================================

describe('External tool configurations', () => {
  let catalog: R2DataCatalog

  beforeEach(() => {
    catalog = new R2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'test-catalog',
      apiToken: 'test-token',
    })
  })

  describe('Spark configuration', () => {
    it('should generate Spark catalog config', () => {
      const config = catalog.getSparkConfig()

      expect(config['spark.sql.catalog.r2']).toBe('org.apache.iceberg.spark.SparkCatalog')
      expect(config['spark.sql.catalog.r2.type']).toBe('rest')
      expect(config['spark.sql.catalog.r2.uri']).toBeDefined()
      expect(config['spark.sql.catalog.r2.warehouse']).toBeDefined()
    })

    it('should include authentication config', () => {
      const config = catalog.getSparkConfig()

      expect(config['spark.sql.catalog.r2.token']).toBeDefined()
    })

    it('should support custom catalog name', () => {
      const config = catalog.getSparkConfig('my_catalog')

      expect(config['spark.sql.catalog.my_catalog']).toBe('org.apache.iceberg.spark.SparkCatalog')
      expect(config['spark.sql.catalog.my_catalog.type']).toBe('rest')
    })

    it('should include S3 file IO config for R2', () => {
      const config = catalog.getSparkConfig()

      expect(config['spark.sql.catalog.r2.io-impl']).toBe('org.apache.iceberg.aws.s3.S3FileIO')
      expect(config['spark.sql.catalog.r2.s3.endpoint']).toContain('r2.cloudflarestorage.com')
    })
  })

  describe('DuckDB configuration', () => {
    it('should generate DuckDB iceberg extension config', () => {
      const config = catalog.getDuckDBConfig()

      expect(config.catalog_uri).toBeDefined()
      expect(config.warehouse).toBeDefined()
      expect(config.token).toBeDefined()
    })

    it('should generate SQL setup statements', () => {
      const sql = catalog.getDuckDBSetupSQL()

      expect(sql).toContain('INSTALL iceberg')
      expect(sql).toContain('LOAD iceberg')
      expect(sql).toContain("CREATE SECRET")
      expect(sql).toContain('ATTACH')
    })

    it('should include S3 credentials for R2', () => {
      const config = catalog.getDuckDBConfig()

      expect(config.s3_endpoint).toContain('r2.cloudflarestorage.com')
      expect(config.s3_access_key_id).toBeDefined()
      expect(config.s3_secret_access_key).toBeDefined()
    })
  })

  describe('Snowflake configuration', () => {
    it('should generate Snowflake external catalog config', () => {
      const config = catalog.getSnowflakeConfig()

      expect(config.CATALOG_SOURCE).toBe('ICEBERG_REST')
      expect(config.CATALOG_URI).toBeDefined()
      expect(config.CATALOG_WAREHOUSE).toBeDefined()
    })

    it('should include external volume config', () => {
      const config = catalog.getSnowflakeConfig()

      expect(config.EXTERNAL_VOLUME).toBeDefined()
    })

    it('should generate CREATE CATALOG SQL', () => {
      const sql = catalog.getSnowflakeCreateCatalogSQL('my_r2_catalog')

      expect(sql).toContain('CREATE OR REPLACE ICEBERG CATALOG')
      expect(sql).toContain('my_r2_catalog')
      expect(sql).toContain('CATALOG_SOURCE = ICEBERG_REST')
      expect(sql).toContain('REST_CONFIG')
    })
  })

  describe('PyIceberg configuration', () => {
    it('should generate PyIceberg config dict', () => {
      const config = catalog.getPyIcebergConfig()

      expect(config.name).toBe('test-catalog')
      expect(config.warehouse).toBeDefined()
      expect(config.uri).toBeDefined()
      expect(config.token).toBeDefined()
    })

    it('should generate Python code snippet', () => {
      const code = catalog.getPyIcebergCodeSnippet()

      expect(code).toContain('from pyiceberg.catalog import load_catalog')
      expect(code).toContain('RestCatalog')
      expect(code).toContain("name='test-catalog'")
    })
  })
})

// ============================================================================
// SCHEMA EVOLUTION TESTS
// ============================================================================

describe('Schema evolution', () => {
  let catalog: R2DataCatalog

  beforeEach(async () => {
    catalog = new R2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'test-catalog',
      apiToken: 'test-token',
    })
    await catalog.createNamespaceIfNotExists('default')
  })

  it('should add columns to existing schema', async () => {
    await catalog.createTable('default', 'evolve-test', {
      type: 'struct',
      fields: [{ id: 1, name: 'id', type: 'long', required: true }],
    })

    const updated = await catalog.evolveSchema('default', 'evolve-test', (builder) =>
      builder.addColumn('name', 'string').addColumn('email', 'string', false)
    )

    expect(updated.schema.fields).toHaveLength(3)
    expect(updated.schema.fields[1].name).toBe('name')
    expect(updated.schema.fields[2].name).toBe('email')
  })

  it('should rename columns', async () => {
    await catalog.createTable('default', 'rename-test', {
      type: 'struct',
      fields: [
        { id: 1, name: 'id', type: 'long', required: true },
        { id: 2, name: 'old_name', type: 'string', required: false },
      ],
    })

    const updated = await catalog.evolveSchema('default', 'rename-test', (builder) => builder.renameColumn('old_name', 'new_name'))

    expect(updated.schema.fields[1].name).toBe('new_name')
  })

  it('should make columns optional', async () => {
    await catalog.createTable('default', 'optional-test', {
      type: 'struct',
      fields: [
        { id: 1, name: 'id', type: 'long', required: true },
        { id: 2, name: 'required_col', type: 'string', required: true },
      ],
    })

    const updated = await catalog.evolveSchema('default', 'optional-test', (builder) =>
      builder.makeColumnOptional('required_col')
    )

    expect(updated.schema.fields[1].required).toBe(false)
  })

  it('should widen column types', async () => {
    await catalog.createTable('default', 'widen-test', {
      type: 'struct',
      fields: [
        { id: 1, name: 'id', type: 'int', required: true },
        { id: 2, name: 'value', type: 'float', required: false },
      ],
    })

    const updated = await catalog.evolveSchema('default', 'widen-test', (builder) =>
      builder.updateColumnType('id', 'long').updateColumnType('value', 'double')
    )

    expect(updated.schema.fields[0].type).toBe('long')
    expect(updated.schema.fields[1].type).toBe('double')
  })

  it('should add nested fields', async () => {
    await catalog.createTable('default', 'nested-test', {
      type: 'struct',
      fields: [
        { id: 1, name: 'id', type: 'long', required: true },
        {
          id: 2,
          name: 'address',
          type: {
            type: 'struct',
            fields: [{ id: 3, name: 'city', type: 'string', required: false }],
          },
          required: false,
        },
      ],
    })

    const updated = await catalog.evolveSchema('default', 'nested-test', (builder) =>
      builder.addColumn('address.state', 'string', false)
    )

    const addressField = updated.schema.fields[1]
    expect((addressField.type as any).fields).toHaveLength(2)
  })
})

// ============================================================================
// TIME TRAVEL TESTS
// ============================================================================

describe('Time travel', () => {
  let catalog: R2DataCatalog

  beforeEach(async () => {
    catalog = new R2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'test-catalog',
      apiToken: 'test-token',
    })
    await catalog.createNamespaceIfNotExists('default')
    await catalog.createTable('default', 'time-travel', {
      type: 'struct',
      fields: [{ id: 1, name: 'id', type: 'long', required: true }],
    })
  })

  it('should list all snapshots', async () => {
    const table = await catalog.loadTable('default', 'time-travel')
    const snapshots = await catalog.listSnapshots('default', 'time-travel')

    expect(snapshots).toBeInstanceOf(Array)
    if (table.currentSnapshotId !== null) {
      expect(snapshots.some((s) => s.snapshotId === table.currentSnapshotId)).toBe(true)
    }
  })

  it('should get snapshot by ID', async () => {
    const table = await catalog.loadTable('default', 'time-travel')

    if (table.currentSnapshotId !== null) {
      const snapshot = await catalog.getSnapshot('default', 'time-travel', table.currentSnapshotId)

      expect(snapshot.snapshotId).toBe(table.currentSnapshotId)
      expect(snapshot.timestampMs).toBeDefined()
      expect(snapshot.manifestList).toBeDefined()
    }
  })

  it('should rollback to previous snapshot', async () => {
    const table = await catalog.loadTable('default', 'time-travel')
    const originalSnapshot = table.currentSnapshotId

    if (originalSnapshot !== null) {
      // Make a change (in real usage, this would append data)
      const withChange = await catalog.commitTable('default', 'time-travel', {
        identifier: { namespace: ['default'], name: 'time-travel' },
        requirements: [],
        updates: [
          {
            action: 'set-properties',
            updates: { 'test': 'value' },
          },
        ],
      })

      // Rollback
      const rolledBack = await catalog.rollbackToSnapshot('default', 'time-travel', originalSnapshot)

      expect(rolledBack.properties?.test).toBeUndefined()
    }
  })

  it('should support branch and tag refs', async () => {
    const table = await catalog.loadTable('default', 'time-travel')

    if (table.currentSnapshotId !== null) {
      // Create a tag
      const tagged = await catalog.commitTable('default', 'time-travel', {
        identifier: { namespace: ['default'], name: 'time-travel' },
        requirements: [],
        updates: [
          {
            action: 'set-snapshot-ref',
            refName: 'v1.0',
            type: 'tag',
            snapshotId: table.currentSnapshotId,
          },
        ],
      })

      expect(tagged.refs?.['v1.0']).toBeDefined()
      expect(tagged.refs?.['v1.0']?.type).toBe('tag')
    }
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error handling', () => {
  let catalog: R2DataCatalog

  beforeEach(() => {
    catalog = new R2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'test-catalog',
      apiToken: 'test-token',
    })
  })

  it('should throw NamespaceNotFoundError with namespace name', async () => {
    try {
      await catalog.loadNamespace('missing')
    } catch (error) {
      expect(error).toBeInstanceOf(NamespaceNotFoundError)
      expect((error as NamespaceNotFoundError).namespace).toEqual(['missing'])
    }
  })

  it('should throw NamespaceAlreadyExistsError with namespace name', async () => {
    await catalog.createNamespace('duplicate')

    try {
      await catalog.createNamespace('duplicate')
    } catch (error) {
      expect(error).toBeInstanceOf(NamespaceAlreadyExistsError)
      expect((error as NamespaceAlreadyExistsError).namespace).toEqual(['duplicate'])
    }
  })

  it('should throw TableNotFoundError with table identifier', async () => {
    await catalog.createNamespaceIfNotExists('default')

    try {
      await catalog.loadTable('default', 'missing')
    } catch (error) {
      expect(error).toBeInstanceOf(TableNotFoundError)
      expect((error as TableNotFoundError).table).toEqual({
        namespace: ['default'],
        name: 'missing',
      })
    }
  })

  it('should throw TableAlreadyExistsError with table identifier', async () => {
    await catalog.createNamespaceIfNotExists('default')
    await catalog.createTable('default', 'duplicate', {
      type: 'struct',
      fields: [{ id: 1, name: 'id', type: 'long', required: true }],
    })

    try {
      await catalog.createTable('default', 'duplicate', {
        type: 'struct',
        fields: [{ id: 1, name: 'id', type: 'long', required: true }],
      })
    } catch (error) {
      expect(error).toBeInstanceOf(TableAlreadyExistsError)
      expect((error as TableAlreadyExistsError).table).toEqual({
        namespace: ['default'],
        name: 'duplicate',
      })
    }
  })

  it('should throw CommitFailedError with details', async () => {
    await catalog.createNamespaceIfNotExists('default')
    await catalog.createTable('default', 'conflict', {
      type: 'struct',
      fields: [{ id: 1, name: 'id', type: 'long', required: true }],
    })

    try {
      await catalog.commitTable('default', 'conflict', {
        identifier: { namespace: ['default'], name: 'conflict' },
        requirements: [
          { type: 'assert-current-schema-id', currentSchemaId: 999 }, // Wrong ID
        ],
        updates: [],
      })
    } catch (error) {
      expect(error).toBeInstanceOf(CommitFailedError)
      expect((error as CommitFailedError).requirement).toBeDefined()
    }
  })

  it('should handle network errors gracefully', async () => {
    const badCatalog = new R2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'test-catalog',
      apiToken: 'invalid-token',
    })

    await expect(badCatalog.listNamespaces()).rejects.toThrow(R2CatalogError)
  })

  it('should include request ID in error responses', async () => {
    try {
      await catalog.loadNamespace('missing')
    } catch (error) {
      expect((error as R2CatalogError).requestId).toBeDefined()
    }
  })
})

// ============================================================================
// METRICS AND OBSERVABILITY TESTS
// ============================================================================

describe('Metrics reporting', () => {
  let catalog: R2DataCatalog

  beforeEach(async () => {
    catalog = new R2DataCatalog({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      catalogName: 'test-catalog',
      apiToken: 'test-token',
    })
    await catalog.createNamespaceIfNotExists('default')
    await catalog.createTable('default', 'metrics-test', {
      type: 'struct',
      fields: [{ id: 1, name: 'id', type: 'long', required: true }],
    })
  })

  it('should report scan metrics', async () => {
    const metrics = {
      snapshotId: 123456789,
      tableName: 'metrics-test',
      projection: ['id'],
      scanMetrics: {
        totalPlanningDuration: 150,
        totalDataManifests: 10,
        totalDeleteManifests: 2,
        scannedDataManifests: 5,
        skippedDataManifests: 5,
        totalFileSizeInBytes: 1024 * 1024 * 100,
        totalDataFiles: 20,
        scannedDataFiles: 10,
        skippedDataFiles: 10,
        totalRecordCount: 1000000,
      },
    }

    await catalog.reportMetrics('default', 'metrics-test', metrics)

    // Should not throw
  })
})
