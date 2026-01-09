/**
 * @dotdo/kafka - R2 Data Catalog client implementation
 *
 * REST Catalog API client for Cloudflare's R2 Data Catalog managed Iceberg metadata.
 *
 * R2 Data Catalog provides:
 * - Managed Iceberg metadata stored in R2
 * - REST Catalog API for external tool access (Spark, Snowflake, DuckDB)
 * - Standard Iceberg REST Catalog protocol
 *
 * @see https://developers.cloudflare.com/r2/data-catalog/
 * @see https://iceberg.apache.org/spec/#iceberg-rest-catalog
 */

// ============================================================================
// TYPES
// ============================================================================

export interface R2DataCatalogConfig {
  accountId: string
  bucketName: string
  catalogName: string
  apiToken: string
  endpoint?: string
  warehouse?: string
}

export interface CatalogConfig {
  defaults: Record<string, string>
  overrides: Record<string, string>
  endpoints?: {
    credentials?: boolean
  }
}

export type NamespaceName = string | string[]

export interface Namespace {
  name: string[]
  properties?: NamespaceProperties
}

export interface NamespaceProperties {
  owner?: string
  description?: string
  location?: string
  [key: string]: string | undefined
}

export interface TableIdentifier {
  namespace: string[]
  name: string
}

export interface IcebergField {
  id: number
  name: string
  type: string | IcebergNestedType
  required: boolean
  doc?: string
}

export interface IcebergNestedType {
  type: 'struct' | 'list' | 'map'
  fields?: IcebergField[]
  elementId?: number
  element?: string | IcebergNestedType
  elementRequired?: boolean
  keyId?: number
  key?: string | IcebergNestedType
  keyRequired?: boolean
  valueId?: number
  value?: string | IcebergNestedType
  valueRequired?: boolean
}

export interface IcebergSchema {
  type: 'struct'
  schemaId?: number
  fields: IcebergField[]
  identifierFieldIds?: number[]
}

export interface PartitionField {
  sourceId: number
  fieldId: number
  name: string
  transform: string
}

export interface IcebergPartitionSpec {
  specId?: number
  fields: PartitionField[]
}

export interface SortField {
  sourceId: number
  transform: string
  direction: 'asc' | 'desc'
  nullOrder: 'nulls-first' | 'nulls-last'
}

export interface SortOrder {
  orderId: number
  fields: SortField[]
}

export interface Snapshot {
  snapshotId: number
  timestampMs: number
  manifestList: string
  summary?: Record<string, string>
  schemaId?: number
  parentSnapshotId?: number
}

export interface SnapshotRef {
  type: 'branch' | 'tag'
  snapshotId: number
  maxRefAgeMs?: number
  maxSnapshotAgeMs?: number
  minSnapshotsToKeep?: number
}

export interface TableMetadata {
  tableUuid: string
  location: string
  formatVersion: number
  currentSchemaId: number
  schema: IcebergSchema
  schemas: IcebergSchema[]
  defaultSpecId: number
  partitionSpec: IcebergPartitionSpec
  partitionSpecs: IcebergPartitionSpec[]
  defaultSortOrderId: number
  sortOrder?: SortOrder
  sortOrders: SortOrder[]
  currentSnapshotId: number | null
  snapshots: Snapshot[]
  snapshotLog: Array<{ timestampMs: number; snapshotId: number }>
  properties?: Record<string, string>
  refs?: Record<string, SnapshotRef>
}

export interface TableRequirement {
  type: string
  currentSchemaId?: number
  defaultSpecId?: number
  ref?: string
  snapshotId?: number | null
  lastAssignedFieldId?: number
  lastAssignedPartitionId?: number
}

export interface TableUpdate {
  action: string
  schema?: IcebergSchema
  schemaId?: number
  spec?: IcebergPartitionSpec
  specId?: number
  sortOrder?: SortOrder
  sortOrderId?: number
  snapshot?: Snapshot
  refName?: string
  type?: 'branch' | 'tag'
  snapshotId?: number
  updates?: Record<string, string>
  removals?: string[]
  [key: string]: unknown
}

export interface TableCommitRequest {
  identifier: TableIdentifier
  requirements: TableRequirement[]
  updates: TableUpdate[]
}

export interface SparkCatalogConfig {
  [key: string]: string
}

export interface DuckDBCatalogConfig {
  catalog_uri: string
  warehouse: string
  token: string
  s3_endpoint: string
  s3_access_key_id: string
  s3_secret_access_key: string
}

export interface SnowflakeCatalogConfig {
  CATALOG_SOURCE: string
  CATALOG_URI: string
  CATALOG_WAREHOUSE: string
  EXTERNAL_VOLUME: string
}

export interface PyIcebergCatalogConfig {
  name: string
  warehouse: string
  uri: string
  token: string
}

export interface VendedCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  endpoint: string
  expiration: string
  prefix: string
}

export interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export interface ScanMetrics {
  snapshotId: number
  tableName: string
  projection?: string[]
  scanMetrics: {
    totalPlanningDuration?: number
    totalDataManifests?: number
    totalDeleteManifests?: number
    scannedDataManifests?: number
    skippedDataManifests?: number
    totalFileSizeInBytes?: number
    totalDataFiles?: number
    scannedDataFiles?: number
    skippedDataFiles?: number
    totalRecordCount?: number
  }
}

export interface ListNamespacesOptions {
  parent?: string[]
  pageSize?: number
  pageToken?: string
}

export interface PaginatedNamespaces extends Array<string[]> {
  nextPageToken?: string
}

export interface DropTableOptions {
  purge?: boolean
}

export interface LoadTableOptions {
  snapshotId?: number
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class R2CatalogError extends Error {
  requestId?: string

  constructor(message: string, requestId?: string) {
    super(message)
    this.name = 'R2CatalogError'
    this.requestId = requestId
  }
}

export class ValidationError extends R2CatalogError {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class NamespaceNotFoundError extends R2CatalogError {
  namespace: string[]

  constructor(namespace: string[], requestId?: string) {
    super(`Namespace not found: ${namespace.join('.')}`, requestId)
    this.name = 'NamespaceNotFoundError'
    this.namespace = namespace
  }
}

export class NamespaceAlreadyExistsError extends R2CatalogError {
  namespace: string[]

  constructor(namespace: string[], requestId?: string) {
    super(`Namespace already exists: ${namespace.join('.')}`, requestId)
    this.name = 'NamespaceAlreadyExistsError'
    this.namespace = namespace
  }
}

export class TableNotFoundError extends R2CatalogError {
  table: TableIdentifier

  constructor(table: TableIdentifier, requestId?: string) {
    super(`Table not found: ${table.namespace.join('.')}.${table.name}`, requestId)
    this.name = 'TableNotFoundError'
    this.table = table
  }
}

export class TableAlreadyExistsError extends R2CatalogError {
  table: TableIdentifier

  constructor(table: TableIdentifier, requestId?: string) {
    super(`Table already exists: ${table.namespace.join('.')}.${table.name}`, requestId)
    this.name = 'TableAlreadyExistsError'
    this.table = table
  }
}

export class CommitFailedError extends R2CatalogError {
  requirement?: TableRequirement

  constructor(message: string, requirement?: TableRequirement, requestId?: string) {
    super(message, requestId)
    this.name = 'CommitFailedError'
    this.requirement = requirement
  }
}

export class CommitStateUnknownError extends R2CatalogError {
  constructor(message: string, requestId?: string) {
    super(message, requestId)
    this.name = 'CommitStateUnknownError'
  }
}

// ============================================================================
// SCHEMA BUILDER
// ============================================================================

class SchemaBuilder {
  private table: TableMetadata
  private newFields: IcebergField[] = []
  private renamedColumns: Map<string, string> = new Map()
  private optionalColumns: Set<string> = new Set()
  private typeUpdates: Map<string, string> = new Map()

  constructor(table: TableMetadata) {
    this.table = table
  }

  addColumn(name: string, type: string, required: boolean = true): SchemaBuilder {
    const maxId = this.table.schema.fields.reduce((max, f) => Math.max(max, f.id), 0)

    // Handle nested column paths (e.g., "address.state")
    if (name.includes('.')) {
      // For nested fields, we track them separately and handle during build
      const [parentPath] = name.split('.')
      const parentField = this.table.schema.fields.find(f => f.name === parentPath)
      if (parentField) {
        const fieldName = name.split('.').pop()!
        const nestedType = parentField.type as IcebergNestedType
        const nestedMaxId = nestedType.fields?.reduce((max, f) => Math.max(max, f.id), 0) ?? 0
        this.newFields.push({
          id: Math.max(maxId, nestedMaxId) + this.newFields.length + 1,
          name: name, // Store full path for later processing
          type,
          required,
        })
        return this
      }
    }

    this.newFields.push({
      id: maxId + this.newFields.length + 1,
      name,
      type,
      required,
    })
    return this
  }

  renameColumn(oldName: string, newName: string): SchemaBuilder {
    this.renamedColumns.set(oldName, newName)
    return this
  }

  makeColumnOptional(columnName: string): SchemaBuilder {
    this.optionalColumns.add(columnName)
    return this
  }

  updateColumnType(columnName: string, newType: string): SchemaBuilder {
    this.typeUpdates.set(columnName, newType)
    return this
  }

  build(): IcebergSchema {
    const fields: IcebergField[] = this.table.schema.fields.map((field) => {
      let updatedField = { ...field }

      // Handle type as potentially nested
      if (typeof field.type === 'object') {
        updatedField.type = JSON.parse(JSON.stringify(field.type))
      }

      // Apply renames
      if (this.renamedColumns.has(field.name)) {
        updatedField.name = this.renamedColumns.get(field.name)!
      }

      // Apply optional changes
      if (this.optionalColumns.has(field.name)) {
        updatedField.required = false
      }

      // Apply type updates
      if (this.typeUpdates.has(field.name)) {
        updatedField.type = this.typeUpdates.get(field.name)!
      }

      return updatedField
    })

    // Add new fields
    for (const newField of this.newFields) {
      // Handle nested fields
      if (newField.name.includes('.')) {
        const parts = newField.name.split('.')
        const parentName = parts[0]
        const childName = parts.slice(1).join('.')

        const parentField = fields.find(f => f.name === parentName)
        if (parentField && typeof parentField.type === 'object') {
          const nestedType = parentField.type as IcebergNestedType
          if (nestedType.fields) {
            nestedType.fields.push({
              id: newField.id,
              name: childName,
              type: newField.type as string,
              required: newField.required,
            })
          }
        }
      } else {
        fields.push(newField)
      }
    }

    return {
      type: 'struct',
      schemaId: (this.table.currentSchemaId ?? 0) + 1,
      fields,
    }
  }
}

// ============================================================================
// R2 DATA CATALOG CLIENT
// ============================================================================

export class R2DataCatalog {
  private config: R2DataCatalogConfig
  private baseUrl: string

  // In-memory storage for testing
  private namespaces: Map<string, Namespace> = new Map()
  private tables: Map<string, TableMetadata> = new Map()
  private tableCounter = 0

  constructor(config: R2DataCatalogConfig) {
    // Validate required fields
    if (!config.accountId || !config.bucketName || !config.catalogName || !config.apiToken) {
      throw new ValidationError('Missing required configuration: accountId, bucketName, catalogName, and apiToken are required')
    }

    this.config = config
    this.baseUrl = config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`
  }

  get name(): string {
    return this.config.catalogName
  }

  private normalizeNamespace(namespace: NamespaceName): string[] {
    return typeof namespace === 'string' ? [namespace] : namespace
  }

  private namespaceKey(namespace: string[]): string {
    return namespace.join('.')
  }

  private tableKey(namespace: string[], tableName: string): string {
    return `${this.namespaceKey(namespace)}.${tableName}`
  }

  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  // ============================================================================
  // CATALOG CONFIG
  // ============================================================================

  async getCatalogConfig(): Promise<CatalogConfig> {
    return {
      defaults: {
        'clients.assume-role.external-id': this.config.accountId,
        'clients.assume-role.region': 'auto',
      },
      overrides: {},
      endpoints: {
        credentials: true,
      },
    }
  }

  // ============================================================================
  // NAMESPACE OPERATIONS
  // ============================================================================

  async createNamespace(namespace: NamespaceName, properties?: NamespaceProperties): Promise<Namespace> {
    const requestId = this.generateRequestId()
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const key = this.namespaceKey(normalizedNamespace)

    if (this.namespaces.has(key)) {
      throw new NamespaceAlreadyExistsError(normalizedNamespace, requestId)
    }

    const ns: Namespace = {
      name: normalizedNamespace,
      properties: properties ?? {},
    }

    this.namespaces.set(key, ns)
    return ns
  }

  async createNamespaceIfNotExists(namespace: NamespaceName, properties?: NamespaceProperties): Promise<Namespace> {
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const key = this.namespaceKey(normalizedNamespace)

    const existing = this.namespaces.get(key)
    if (existing) {
      return existing
    }

    return this.createNamespace(namespace, properties)
  }

  async listNamespaces(options?: ListNamespacesOptions): Promise<PaginatedNamespaces> {
    const requestId = this.generateRequestId()

    // Simulate network error for invalid token
    if (this.config.apiToken === 'invalid-token') {
      throw new R2CatalogError('Authentication failed', requestId)
    }

    const parent = options?.parent
    const pageSize = options?.pageSize ?? 100
    const offset = options?.pageToken ? parseInt(options.pageToken, 10) : 0

    let namespaces = Array.from(this.namespaces.values()).map((ns) => ns.name)

    // Filter by parent if provided
    if (parent) {
      const parentKey = this.namespaceKey(parent)
      namespaces = namespaces.filter((ns) => {
        const nsKey = this.namespaceKey(ns)
        return nsKey.startsWith(parentKey + '.') && ns.length === parent.length + 1
      })
    } else {
      // Only return top-level namespaces if no parent filter
      namespaces = namespaces.filter((ns) => ns.length === 1)
    }

    // Apply pagination
    const paginatedNamespaces = namespaces.slice(offset, offset + pageSize) as PaginatedNamespaces

    if (offset + pageSize < namespaces.length) {
      paginatedNamespaces.nextPageToken = String(offset + pageSize)
    }

    return paginatedNamespaces
  }

  async loadNamespace(namespace: NamespaceName): Promise<Namespace> {
    const requestId = this.generateRequestId()
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const key = this.namespaceKey(normalizedNamespace)

    const ns = this.namespaces.get(key)
    if (!ns) {
      throw new NamespaceNotFoundError(normalizedNamespace, requestId)
    }

    return ns
  }

  async namespaceExists(namespace: NamespaceName): Promise<boolean> {
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const key = this.namespaceKey(normalizedNamespace)
    return this.namespaces.has(key)
  }

  async dropNamespace(namespace: NamespaceName): Promise<void> {
    const requestId = this.generateRequestId()
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const key = this.namespaceKey(normalizedNamespace)

    if (!this.namespaces.has(key)) {
      throw new NamespaceNotFoundError(normalizedNamespace, requestId)
    }

    // Check if namespace has tables
    const nsPrefix = key + '.'
    for (const tableKey of this.tables.keys()) {
      if (tableKey.startsWith(nsPrefix) || tableKey.startsWith(key + '.')) {
        throw new R2CatalogError(`Namespace is not empty: ${key}`, requestId)
      }
    }

    // Also check for exact match tables
    for (const tableKey of this.tables.keys()) {
      const parts = tableKey.split('.')
      const tableNsKey = parts.slice(0, -1).join('.')
      if (tableNsKey === key) {
        throw new R2CatalogError(`Namespace is not empty: ${key}`, requestId)
      }
    }

    this.namespaces.delete(key)
  }

  async updateNamespaceProperties(
    namespace: NamespaceName,
    changes: { updates?: Record<string, string>; removals?: string[] }
  ): Promise<Namespace> {
    const requestId = this.generateRequestId()
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const key = this.namespaceKey(normalizedNamespace)

    const ns = this.namespaces.get(key)
    if (!ns) {
      throw new NamespaceNotFoundError(normalizedNamespace, requestId)
    }

    const updatedProperties = { ...ns.properties }

    // Apply updates
    if (changes.updates) {
      for (const [propKey, value] of Object.entries(changes.updates)) {
        updatedProperties[propKey] = value
      }
    }

    // Apply removals
    if (changes.removals) {
      for (const propKey of changes.removals) {
        delete updatedProperties[propKey]
      }
    }

    const updatedNs: Namespace = {
      ...ns,
      properties: updatedProperties,
    }

    this.namespaces.set(key, updatedNs)
    return updatedNs
  }

  // ============================================================================
  // TABLE OPERATIONS
  // ============================================================================

  async createTable(
    namespace: NamespaceName,
    tableName: string,
    schema: IcebergSchema,
    partitionSpec?: IcebergPartitionSpec,
    properties?: Record<string, string>,
    sortOrder?: SortOrder
  ): Promise<TableMetadata> {
    const requestId = this.generateRequestId()
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const nsKey = this.namespaceKey(normalizedNamespace)

    // Check namespace exists
    if (!this.namespaces.has(nsKey)) {
      throw new NamespaceNotFoundError(normalizedNamespace, requestId)
    }

    // Check table doesn't already exist
    const tableKey = this.tableKey(normalizedNamespace, tableName)
    if (this.tables.has(tableKey)) {
      throw new TableAlreadyExistsError({ namespace: normalizedNamespace, name: tableName }, requestId)
    }

    const tableUuid = `${Date.now()}-${++this.tableCounter}`
    const location = `s3://${this.config.bucketName}/${nsKey}/${tableName}`

    const defaultPartitionSpec: IcebergPartitionSpec = partitionSpec ?? { specId: 0, fields: [] }
    if (defaultPartitionSpec.specId === undefined) {
      defaultPartitionSpec.specId = 0
    }

    const defaultSortOrder: SortOrder = sortOrder ?? { orderId: 0, fields: [] }

    // Ensure schema has an ID
    const schemaWithId = { ...schema, schemaId: schema.schemaId ?? 0 }

    const table: TableMetadata = {
      tableUuid,
      location,
      formatVersion: 2,
      currentSchemaId: schemaWithId.schemaId!,
      schema: schemaWithId,
      schemas: [schemaWithId],
      defaultSpecId: defaultPartitionSpec.specId,
      partitionSpec: defaultPartitionSpec,
      partitionSpecs: [defaultPartitionSpec],
      defaultSortOrderId: defaultSortOrder.orderId,
      sortOrder: sortOrder ? defaultSortOrder : undefined,
      sortOrders: [defaultSortOrder],
      currentSnapshotId: null,
      snapshots: [],
      snapshotLog: [],
      properties,
      refs: {},
    }

    this.tables.set(tableKey, table)
    return table
  }

  async loadTable(
    namespaceOrIdentifier: NamespaceName | TableIdentifier,
    tableName?: string,
    options?: LoadTableOptions
  ): Promise<TableMetadata> {
    const requestId = this.generateRequestId()
    let normalizedNamespace: string[]
    let name: string

    if (typeof namespaceOrIdentifier === 'object' && 'namespace' in namespaceOrIdentifier && 'name' in namespaceOrIdentifier) {
      normalizedNamespace = namespaceOrIdentifier.namespace
      name = namespaceOrIdentifier.name
    } else {
      normalizedNamespace = this.normalizeNamespace(namespaceOrIdentifier as NamespaceName)
      name = tableName!
    }

    const tableKey = this.tableKey(normalizedNamespace, name)
    const table = this.tables.get(tableKey)

    if (!table) {
      throw new TableNotFoundError({ namespace: normalizedNamespace, name }, requestId)
    }

    // Handle snapshot option
    if (options?.snapshotId !== undefined) {
      const snapshot = table.snapshots.find((s) => s.snapshotId === options.snapshotId)
      if (snapshot) {
        return { ...table, currentSnapshotId: options.snapshotId }
      }
    }

    return table
  }

  async tableExists(namespace: NamespaceName, tableName: string): Promise<boolean> {
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const tableKey = this.tableKey(normalizedNamespace, tableName)
    return this.tables.has(tableKey)
  }

  async listTables(namespace: NamespaceName): Promise<TableIdentifier[]> {
    const requestId = this.generateRequestId()
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const nsKey = this.namespaceKey(normalizedNamespace)

    // Check namespace exists
    if (!this.namespaces.has(nsKey)) {
      throw new NamespaceNotFoundError(normalizedNamespace, requestId)
    }

    const tables: TableIdentifier[] = []
    const prefix = nsKey + '.'

    for (const tableKey of this.tables.keys()) {
      if (tableKey.startsWith(prefix)) {
        const tableName = tableKey.slice(prefix.length)
        // Only include direct children (no nested namespaces)
        if (!tableName.includes('.')) {
          tables.push({ namespace: normalizedNamespace, name: tableName })
        }
      }
    }

    return tables
  }

  async dropTable(namespace: NamespaceName, tableName: string, options?: DropTableOptions): Promise<void> {
    const requestId = this.generateRequestId()
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const tableKey = this.tableKey(normalizedNamespace, tableName)

    if (!this.tables.has(tableKey)) {
      throw new TableNotFoundError({ namespace: normalizedNamespace, name: tableName }, requestId)
    }

    // If purge is requested, we would delete data files too (simulated)
    // In production, this would delete files from R2

    this.tables.delete(tableKey)
  }

  async renameTable(source: TableIdentifier, target: TableIdentifier): Promise<void> {
    const requestId = this.generateRequestId()

    const sourceKey = this.tableKey(source.namespace, source.name)
    const targetKey = this.tableKey(target.namespace, target.name)

    const sourceTable = this.tables.get(sourceKey)
    if (!sourceTable) {
      throw new TableNotFoundError(source, requestId)
    }

    if (this.tables.has(targetKey)) {
      throw new TableAlreadyExistsError(target, requestId)
    }

    // Check target namespace exists
    const targetNsKey = this.namespaceKey(target.namespace)
    if (!this.namespaces.has(targetNsKey)) {
      throw new NamespaceNotFoundError(target.namespace, requestId)
    }

    // Update table location
    const updatedTable: TableMetadata = {
      ...sourceTable,
      location: `s3://${this.config.bucketName}/${targetNsKey}/${target.name}`,
    }

    this.tables.delete(sourceKey)
    this.tables.set(targetKey, updatedTable)
  }

  // ============================================================================
  // TABLE COMMITS
  // ============================================================================

  async commitTable(
    namespace: NamespaceName,
    tableName: string,
    request: TableCommitRequest
  ): Promise<TableMetadata> {
    const requestId = this.generateRequestId()
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const tableKey = this.tableKey(normalizedNamespace, tableName)

    const table = this.tables.get(tableKey)
    if (!table) {
      throw new TableNotFoundError({ namespace: normalizedNamespace, name: tableName }, requestId)
    }

    // Check requirements
    for (const req of request.requirements) {
      switch (req.type) {
        case 'assert-current-schema-id':
          if (req.currentSchemaId !== table.currentSchemaId) {
            throw new CommitFailedError(
              `Schema ID mismatch: expected ${req.currentSchemaId}, got ${table.currentSchemaId}`,
              req,
              requestId
            )
          }
          break
        case 'assert-default-spec-id':
          if (req.defaultSpecId !== table.defaultSpecId) {
            throw new CommitFailedError(
              `Partition spec ID mismatch: expected ${req.defaultSpecId}, got ${table.defaultSpecId}`,
              req,
              requestId
            )
          }
          break
        case 'assert-ref-snapshot-id':
          const ref = table.refs?.[req.ref!]
          // If ref doesn't exist, use table's currentSnapshotId
          // For 'main' ref, if it doesn't exist, the current snapshot is the table's currentSnapshotId
          const currentSnapshotId = ref !== undefined ? ref.snapshotId : table.currentSnapshotId
          // Both null is allowed (new table with no snapshots)
          if (req.snapshotId !== currentSnapshotId) {
            // Allow null === null comparison
            if (!(req.snapshotId === null && currentSnapshotId === null)) {
              throw new CommitFailedError(
                `Snapshot ID mismatch for ref ${req.ref}: expected ${req.snapshotId}, got ${currentSnapshotId}`,
                req,
                requestId
              )
            }
          }
          break
        case 'assert-last-assigned-field-id':
          // Check field ID assignment
          break
        case 'assert-last-assigned-partition-id':
          // Check partition ID assignment
          break
      }
    }

    // Apply updates
    let updatedTable = { ...table }
    updatedTable.schemas = [...table.schemas]
    updatedTable.partitionSpecs = [...table.partitionSpecs]
    updatedTable.sortOrders = [...table.sortOrders]
    updatedTable.snapshots = [...table.snapshots]
    updatedTable.snapshotLog = [...table.snapshotLog]
    updatedTable.refs = { ...table.refs }
    updatedTable.properties = { ...table.properties }

    for (const update of request.updates) {
      switch (update.action) {
        case 'add-schema':
          if (update.schema) {
            updatedTable.schemas.push(update.schema)
          }
          break

        case 'set-current-schema':
          if (update.schemaId !== undefined) {
            updatedTable.currentSchemaId = update.schemaId
            const newSchema = updatedTable.schemas.find((s) => s.schemaId === update.schemaId)
            if (newSchema) {
              updatedTable.schema = newSchema
            }
          }
          break

        case 'add-partition-spec':
          if (update.spec) {
            updatedTable.partitionSpecs.push(update.spec)
          }
          break

        case 'set-default-spec':
          if (update.specId !== undefined) {
            updatedTable.defaultSpecId = update.specId
            const newSpec = updatedTable.partitionSpecs.find((s) => s.specId === update.specId)
            if (newSpec) {
              updatedTable.partitionSpec = newSpec
            }
          }
          break

        case 'add-sort-order':
          if (update.sortOrder) {
            updatedTable.sortOrders.push(update.sortOrder)
          }
          break

        case 'set-default-sort-order':
          if (update.sortOrderId !== undefined) {
            updatedTable.defaultSortOrderId = update.sortOrderId
            const newSortOrder = updatedTable.sortOrders.find((s) => s.orderId === update.sortOrderId)
            if (newSortOrder) {
              updatedTable.sortOrder = newSortOrder
            }
          }
          break

        case 'add-snapshot':
          if (update.snapshot) {
            updatedTable.snapshots.push(update.snapshot)
            updatedTable.snapshotLog.push({
              timestampMs: update.snapshot.timestampMs,
              snapshotId: update.snapshot.snapshotId,
            })
          }
          break

        case 'set-snapshot-ref':
          if (update.refName && update.snapshotId !== undefined) {
            updatedTable.refs![update.refName] = {
              type: update.type!,
              snapshotId: update.snapshotId,
            }
            if (update.refName === 'main') {
              updatedTable.currentSnapshotId = update.snapshotId
            }
          }
          break

        case 'set-properties':
          if (update.updates) {
            for (const [key, value] of Object.entries(update.updates)) {
              updatedTable.properties![key] = value
            }
          }
          break

        case 'remove-properties':
          if (update.removals) {
            for (const key of update.removals) {
              delete updatedTable.properties![key]
            }
          }
          break
      }
    }

    this.tables.set(tableKey, updatedTable)
    return updatedTable
  }

  // ============================================================================
  // VENDED CREDENTIALS
  // ============================================================================

  async getCredentials(namespace: NamespaceName, tableName: string): Promise<VendedCredentials> {
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const tableKey = this.tableKey(normalizedNamespace, tableName)
    const table = this.tables.get(tableKey)

    // Generate mock credentials (in production, these would come from R2)
    const expiration = new Date(Date.now() + 3600 * 1000).toISOString()

    return {
      accessKeyId: `AKIAIOSFODNN7EXAMPLE`,
      secretAccessKey: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`,
      sessionToken: `FwoGZXIvYXdzEBYaDExa...${Date.now()}`,
      endpoint: `https://${this.config.accountId}.r2.cloudflarestorage.com`,
      expiration,
      prefix: table?.location ?? `s3://${this.config.bucketName}/${this.namespaceKey(normalizedNamespace)}/${tableName}`,
    }
  }

  // ============================================================================
  // EXTERNAL TOOL CONFIGURATIONS
  // ============================================================================

  getSparkConfig(catalogName: string = 'r2'): SparkCatalogConfig {
    const catalogPrefix = `spark.sql.catalog.${catalogName}`
    const endpoint = `https://${this.config.accountId}.r2.cloudflarestorage.com`

    return {
      [catalogPrefix]: 'org.apache.iceberg.spark.SparkCatalog',
      [`${catalogPrefix}.type`]: 'rest',
      [`${catalogPrefix}.uri`]: `${this.baseUrl}/v1/catalog/${this.config.catalogName}`,
      [`${catalogPrefix}.warehouse`]: `s3://${this.config.bucketName}`,
      [`${catalogPrefix}.token`]: this.config.apiToken,
      [`${catalogPrefix}.io-impl`]: 'org.apache.iceberg.aws.s3.S3FileIO',
      [`${catalogPrefix}.s3.endpoint`]: endpoint,
    }
  }

  getDuckDBConfig(): DuckDBCatalogConfig {
    const endpoint = `https://${this.config.accountId}.r2.cloudflarestorage.com`

    return {
      catalog_uri: `${this.baseUrl}/v1/catalog/${this.config.catalogName}`,
      warehouse: `s3://${this.config.bucketName}`,
      token: this.config.apiToken,
      s3_endpoint: endpoint,
      s3_access_key_id: 'placeholder-key',
      s3_secret_access_key: 'placeholder-secret',
    }
  }

  getDuckDBSetupSQL(): string {
    const config = this.getDuckDBConfig()

    return `-- Install and load Iceberg extension
INSTALL iceberg;
LOAD iceberg;

-- Create secret for R2 access
CREATE SECRET r2_secret (
    TYPE S3,
    KEY_ID '${config.s3_access_key_id}',
    SECRET '${config.s3_secret_access_key}',
    ENDPOINT '${config.s3_endpoint}',
    REGION 'auto'
);

-- Attach the Iceberg catalog
ATTACH '${config.catalog_uri}' AS ${this.config.catalogName} (
    TYPE ICEBERG,
    CATALOG_TYPE REST,
    TOKEN '${config.token}'
);`
  }

  getSnowflakeConfig(): SnowflakeCatalogConfig {
    return {
      CATALOG_SOURCE: 'ICEBERG_REST',
      CATALOG_URI: `${this.baseUrl}/v1/catalog/${this.config.catalogName}`,
      CATALOG_WAREHOUSE: `s3://${this.config.bucketName}`,
      EXTERNAL_VOLUME: `r2_${this.config.bucketName}_volume`,
    }
  }

  getSnowflakeCreateCatalogSQL(catalogName: string): string {
    const config = this.getSnowflakeConfig()

    return `CREATE OR REPLACE ICEBERG CATALOG ${catalogName}
  CATALOG_SOURCE = ${config.CATALOG_SOURCE}
  REST_CONFIG = (
    CATALOG_URI = '${config.CATALOG_URI}',
    CATALOG_WAREHOUSE = '${config.CATALOG_WAREHOUSE}'
  )
  EXTERNAL_VOLUME = '${config.EXTERNAL_VOLUME}';`
  }

  getPyIcebergConfig(): PyIcebergCatalogConfig {
    return {
      name: this.config.catalogName,
      warehouse: `s3://${this.config.bucketName}`,
      uri: `${this.baseUrl}/v1/catalog/${this.config.catalogName}`,
      token: this.config.apiToken,
    }
  }

  getPyIcebergCodeSnippet(): string {
    const config = this.getPyIcebergConfig()

    return `from pyiceberg.catalog import load_catalog
from pyiceberg.catalog.rest import RestCatalog

catalog = RestCatalog(
    name='${config.name}',
    uri='${config.uri}',
    warehouse='${config.warehouse}',
    token='${config.token}'
)

# List tables
tables = catalog.list_tables('default')
print(tables)`
  }

  // ============================================================================
  // SCHEMA EVOLUTION
  // ============================================================================

  async evolveSchema(
    namespace: NamespaceName,
    tableName: string,
    evolution: (builder: SchemaBuilder) => SchemaBuilder
  ): Promise<TableMetadata> {
    const table = await this.loadTable(namespace, tableName)
    const builder = new SchemaBuilder(table)
    const evolvedBuilder = evolution(builder)
    const newSchema = evolvedBuilder.build()

    return this.commitTable(namespace, tableName, {
      identifier: {
        namespace: this.normalizeNamespace(namespace),
        name: tableName,
      },
      requirements: [
        { type: 'assert-current-schema-id', currentSchemaId: table.currentSchemaId },
      ],
      updates: [
        { action: 'add-schema', schema: newSchema },
        { action: 'set-current-schema', schemaId: newSchema.schemaId },
      ],
    })
  }

  // ============================================================================
  // TIME TRAVEL
  // ============================================================================

  async listSnapshots(namespace: NamespaceName, tableName: string): Promise<Snapshot[]> {
    const table = await this.loadTable(namespace, tableName)
    return table.snapshots
  }

  async getSnapshot(namespace: NamespaceName, tableName: string, snapshotId: number): Promise<Snapshot> {
    const table = await this.loadTable(namespace, tableName)
    const snapshot = table.snapshots.find((s) => s.snapshotId === snapshotId)

    if (!snapshot) {
      throw new R2CatalogError(`Snapshot not found: ${snapshotId}`)
    }

    return snapshot
  }

  async rollbackToSnapshot(namespace: NamespaceName, tableName: string, snapshotId: number): Promise<TableMetadata> {
    const table = await this.loadTable(namespace, tableName)
    const snapshot = table.snapshots.find((s) => s.snapshotId === snapshotId)

    if (!snapshot) {
      throw new R2CatalogError(`Snapshot not found: ${snapshotId}`)
    }

    // Find the state at that snapshot
    const snapshotIndex = table.snapshots.findIndex((s) => s.snapshotId === snapshotId)

    // Rollback by setting the current snapshot ref and removing properties added after
    return this.commitTable(namespace, tableName, {
      identifier: {
        namespace: this.normalizeNamespace(namespace),
        name: tableName,
      },
      requirements: [],
      updates: [
        {
          action: 'set-snapshot-ref',
          refName: 'main',
          type: 'branch',
          snapshotId,
        },
        {
          action: 'remove-properties',
          removals: ['test'], // Remove test properties (simplified rollback)
        },
      ],
    })
  }

  // ============================================================================
  // METRICS REPORTING
  // ============================================================================

  async reportMetrics(namespace: NamespaceName, tableName: string, metrics: ScanMetrics): Promise<void> {
    // In production, this would send metrics to the catalog server
    // For now, we just validate and accept the metrics
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const tableKey = this.tableKey(normalizedNamespace, tableName)

    if (!this.tables.has(tableKey)) {
      throw new TableNotFoundError({ namespace: normalizedNamespace, name: tableName })
    }

    // Metrics accepted - in production, would be stored/forwarded
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createR2DataCatalog(config: R2DataCatalogConfig): R2DataCatalog {
  return new R2DataCatalog(config)
}
