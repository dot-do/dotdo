/**
 * @dotdo/salesforce - Salesforce Connect (External Objects) Support
 *
 * Provides support for Salesforce Connect external objects, OData integration,
 * cross-org sync, and external data source management.
 *
 * @see https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_objects_externaldatasource.htm
 * @module @dotdo/salesforce/connect
 */

import type { Connection } from './salesforce'
import type { SObject, SObjectAttributes, QueryResult, SaveResult } from './types'

// =============================================================================
// External Data Source Types
// =============================================================================

/**
 * External data source type
 */
export type ExternalDataSourceType =
  | 'OData'
  | 'OData4'
  | 'CustomAdapter'
  | 'SalesforceConnect'
  | 'CrossOrg'
  | 'SimpleURL'

/**
 * Authentication protocol for external data sources
 */
export type AuthenticationProtocol =
  | 'NoAuthentication'
  | 'Password'
  | 'OAuth'
  | 'Certificate'
  | 'AwsSig4'
  | 'Jwt'
  | 'JwtExchange'

/**
 * Identity type for external data sources
 */
export type IdentityType =
  | 'Anonymous'
  | 'NamedUser'
  | 'PerUser'

/**
 * External data source configuration
 */
export interface ExternalDataSourceConfig {
  /** Developer name (API name) */
  developerName: string
  /** Display label */
  label: string
  /** Type of external data source */
  type: ExternalDataSourceType
  /** Endpoint URL */
  endpoint: string
  /** Authentication protocol */
  authenticationProtocol?: AuthenticationProtocol
  /** Identity type */
  identityType?: IdentityType
  /** Named credential (for OAuth/Certificate auth) */
  namedCredential?: string
  /** Principal type */
  principalType?: 'Anonymous' | 'NamedUser' | 'PerUser'
  /** Is writable */
  isWritable?: boolean
  /** Custom HTTP headers */
  customHttpHeaders?: Record<string, string>
  /** OData entity namespace */
  oDataNamespace?: string
  /** Large icon URL */
  largeIconUrl?: string
  /** Small icon URL */
  smallIconUrl?: string
  /** Description */
  description?: string
}

/**
 * External data source record
 */
export interface ExternalDataSource extends SObject {
  Id?: string
  DeveloperName: string
  MasterLabel: string
  Type: ExternalDataSourceType
  Endpoint: string
  AuthenticationProtocol?: AuthenticationProtocol
  IdentityType?: IdentityType
  NamedCredentialId?: string
  PrincipalType?: string
  IsWritable?: boolean
  LargeIconUrl?: string
  SmallIconUrl?: string
  Description?: string
  CreatedDate?: string
  LastModifiedDate?: string
  SystemModstamp?: string
}

// =============================================================================
// External Object Types
// =============================================================================

/**
 * External object attributes (similar to standard SObject but with external source info)
 */
export interface ExternalObjectAttributes extends SObjectAttributes {
  type: string
  url: string
  externalId?: string
}

/**
 * Base interface for external objects (ending with __x)
 */
export interface ExternalObject extends SObject {
  /** External ID from the external system */
  ExternalId?: string
  /** Display URL in external system */
  DisplayUrl?: string
  /** External object attributes */
  attributes?: ExternalObjectAttributes
}

/**
 * External object field definition
 */
export interface ExternalObjectField {
  /** Field name (API name) */
  name: string
  /** Field label */
  label: string
  /** Field type */
  type: string
  /** External column name in the external system */
  externalColumnName?: string
  /** Length for text fields */
  length?: number
  /** Is filterable */
  isFilterable?: boolean
  /** Is sortable */
  isSortable?: boolean
  /** Is external ID */
  isExternalId?: boolean
  /** Reference to another object (for relationships) */
  referenceTo?: string
  /** Relationship name */
  relationshipName?: string
}

/**
 * External object definition
 */
export interface ExternalObjectDefinition {
  /** API name (ends with __x) */
  name: string
  /** Display label */
  label: string
  /** Plural label */
  labelPlural: string
  /** External data source ID */
  externalDataSourceId: string
  /** Table name in external system */
  externalTableName: string
  /** Fields */
  fields: ExternalObjectField[]
  /** Description */
  description?: string
}

// =============================================================================
// OData Types
// =============================================================================

/**
 * OData version supported
 */
export type ODataVersion = '2.0' | '4.0'

/**
 * OData entity set metadata
 */
export interface ODataEntitySet {
  name: string
  entityType: string
  url: string
}

/**
 * OData entity type metadata
 */
export interface ODataEntityType {
  name: string
  namespace?: string
  properties: ODataProperty[]
  key: string[]
  navigationProperties?: ODataNavigationProperty[]
}

/**
 * OData property
 */
export interface ODataProperty {
  name: string
  type: string
  nullable?: boolean
  maxLength?: number
  precision?: number
  scale?: number
}

/**
 * OData navigation property (for relationships)
 */
export interface ODataNavigationProperty {
  name: string
  type: string
  partner?: string
  nullable?: boolean
}

/**
 * OData service metadata
 */
export interface ODataServiceMetadata {
  version: ODataVersion
  serviceRoot: string
  entitySets: ODataEntitySet[]
  entityTypes: ODataEntityType[]
}

/**
 * OData query options
 */
export interface ODataQueryOptions {
  $filter?: string
  $select?: string
  $expand?: string
  $orderby?: string
  $top?: number
  $skip?: number
  $count?: boolean
  $search?: string
}

/**
 * OData response wrapper
 */
export interface ODataResponse<T = unknown> {
  '@odata.context'?: string
  '@odata.count'?: number
  '@odata.nextLink'?: string
  value: T[]
}

// =============================================================================
// Cross-Org Sync Types
// =============================================================================

/**
 * Cross-org connection type
 */
export type CrossOrgConnectionType = 'OrgToOrg' | 'Hub' | 'Spoke'

/**
 * Cross-org adapter configuration
 */
export interface CrossOrgAdapterConfig {
  /** Source org instance URL */
  sourceOrgUrl: string
  /** Source org named credential */
  sourceOrgCredential: string
  /** Objects to sync */
  objectsToSync: string[]
  /** Sync direction */
  syncDirection: 'Bidirectional' | 'SourceToTarget' | 'TargetToSource'
  /** Enable change data capture */
  enableCDC?: boolean
  /** Sync frequency (in minutes, 0 for real-time) */
  syncFrequency?: number
}

/**
 * Cross-org sync status
 */
export interface CrossOrgSyncStatus {
  objectName: string
  lastSyncTime?: string
  recordsSynced?: number
  recordsFailed?: number
  status: 'Success' | 'Partial' | 'Failed' | 'InProgress' | 'Pending'
  errorMessage?: string
}

// =============================================================================
// Connect Class Implementation
// =============================================================================

/**
 * Salesforce Connect handler for external objects and data sources
 */
export class Connect {
  private conn: Connection

  constructor(conn: Connection) {
    this.conn = conn
  }

  // ===========================================================================
  // External Data Source Operations
  // ===========================================================================

  /**
   * List all external data sources
   */
  async listDataSources(): Promise<ExternalDataSource[]> {
    const result = await this.conn.query<ExternalDataSource>(
      'SELECT Id, DeveloperName, MasterLabel, Type, Endpoint, AuthenticationProtocol, ' +
      'IdentityType, PrincipalType, IsWritable, Description, CreatedDate, LastModifiedDate ' +
      'FROM ExternalDataSource'
    )
    return result.records
  }

  /**
   * Get a specific external data source by developer name
   */
  async getDataSource(developerName: string): Promise<ExternalDataSource | null> {
    const result = await this.conn.query<ExternalDataSource>(
      `SELECT Id, DeveloperName, MasterLabel, Type, Endpoint, AuthenticationProtocol, ` +
      `IdentityType, PrincipalType, IsWritable, Description, CreatedDate, LastModifiedDate ` +
      `FROM ExternalDataSource WHERE DeveloperName = '${developerName}'`
    )
    return result.records[0] || null
  }

  /**
   * Create a new external data source
   * Note: This uses the Metadata API
   */
  async createDataSource(config: ExternalDataSourceConfig): Promise<SaveResult> {
    const metadata = {
      fullName: config.developerName,
      label: config.label,
      type: config.type,
      endpoint: config.endpoint,
      principalType: config.principalType || 'NamedUser',
      protocol: config.authenticationProtocol || 'Password',
      identityType: config.identityType || 'NamedUser',
      isWritable: config.isWritable ?? false,
      customHttpHeaders: config.customHttpHeaders,
      oDataNamespace: config.oDataNamespace,
    }

    return this.conn._request<SaveResult>(
      'POST',
      `${this.conn.instanceUrl}/services/data/v${this.conn.version}/tooling/sobjects/ExternalDataSource`,
      metadata
    )
  }

  /**
   * Update an existing external data source
   */
  async updateDataSource(id: string, updates: Partial<ExternalDataSourceConfig>): Promise<SaveResult> {
    return this.conn._request<SaveResult>(
      'PATCH',
      `${this.conn.instanceUrl}/services/data/v${this.conn.version}/tooling/sobjects/ExternalDataSource/${id}`,
      updates
    )
  }

  /**
   * Delete an external data source
   */
  async deleteDataSource(id: string): Promise<SaveResult> {
    await this.conn._request<null>(
      'DELETE',
      `${this.conn.instanceUrl}/services/data/v${this.conn.version}/tooling/sobjects/ExternalDataSource/${id}`
    )
    return { id, success: true, errors: [] }
  }

  /**
   * Validate external data source connection
   */
  async validateDataSource(id: string): Promise<{ success: boolean; message?: string }> {
    try {
      const result = await this.conn._request<{ isSuccess: boolean; errorMessage?: string }>(
        'POST',
        `${this.conn.instanceUrl}/services/data/v${this.conn.version}/connect/external-data-sources/${id}/validate`,
        {}
      )
      return { success: result.isSuccess, message: result.errorMessage }
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Validation failed' }
    }
  }

  // ===========================================================================
  // External Object Operations
  // ===========================================================================

  /**
   * List all external objects
   */
  async listExternalObjects(): Promise<Array<{ name: string; label: string; externalDataSourceId: string }>> {
    const result = await this.conn.describeGlobal()
    const externalObjects = result.sobjects.filter(obj => obj.name.endsWith('__x'))
    return externalObjects.map(obj => ({
      name: obj.name,
      label: obj.label,
      externalDataSourceId: '', // Would need additional query to get this
    }))
  }

  /**
   * Query external object records
   */
  async queryExternal<T extends ExternalObject>(
    objectName: string,
    fields: string[],
    conditions?: Record<string, unknown>,
    options?: { limit?: number; offset?: number; orderBy?: string }
  ): Promise<QueryResult<T>> {
    // Ensure object name ends with __x
    const externalObjectName = objectName.endsWith('__x') ? objectName : `${objectName}__x`

    let soql = `SELECT ${fields.join(', ')} FROM ${externalObjectName}`

    if (conditions && Object.keys(conditions).length > 0) {
      const whereClauses = Object.entries(conditions).map(([field, value]) => {
        if (value === null) return `${field} = null`
        if (typeof value === 'string') return `${field} = '${value}'`
        return `${field} = ${value}`
      })
      soql += ` WHERE ${whereClauses.join(' AND ')}`
    }

    if (options?.orderBy) {
      soql += ` ORDER BY ${options.orderBy}`
    }

    if (options?.limit) {
      soql += ` LIMIT ${options.limit}`
    }

    if (options?.offset) {
      soql += ` OFFSET ${options.offset}`
    }

    return this.conn.query<T>(soql)
  }

  /**
   * Get an external object record by external ID
   */
  async getExternalRecord<T extends ExternalObject>(
    objectName: string,
    externalId: string,
    fields?: string[]
  ): Promise<T | null> {
    const externalObjectName = objectName.endsWith('__x') ? objectName : `${objectName}__x`
    const selectFields = fields?.join(', ') || 'Id, ExternalId, DisplayUrl'

    const result = await this.conn.query<T>(
      `SELECT ${selectFields} FROM ${externalObjectName} WHERE ExternalId = '${externalId}'`
    )

    return result.records[0] || null
  }

  /**
   * Create/update record in writable external object
   */
  async upsertExternalRecord(
    objectName: string,
    record: ExternalObject
  ): Promise<SaveResult> {
    const externalObjectName = objectName.endsWith('__x') ? objectName : `${objectName}__x`

    return this.conn._request<SaveResult>(
      'POST',
      `${this.conn.instanceUrl}/services/data/v${this.conn.version}/sobjects/${externalObjectName}`,
      record
    )
  }

  /**
   * Delete record from writable external object
   */
  async deleteExternalRecord(
    objectName: string,
    externalId: string
  ): Promise<SaveResult> {
    const externalObjectName = objectName.endsWith('__x') ? objectName : `${objectName}__x`

    // First get the Salesforce ID for the external ID
    const record = await this.getExternalRecord(externalObjectName, externalId, ['Id'])
    if (!record?.Id) {
      return { id: externalId, success: false, errors: [{ errorCode: 'NOT_FOUND', message: 'External record not found' }] }
    }

    await this.conn._request<null>(
      'DELETE',
      `${this.conn.instanceUrl}/services/data/v${this.conn.version}/sobjects/${externalObjectName}/${record.Id}`
    )

    return { id: record.Id, success: true, errors: [] }
  }

  // ===========================================================================
  // OData Operations
  // ===========================================================================

  /**
   * Get OData service metadata from an endpoint
   */
  async getODataMetadata(endpoint: string, version: ODataVersion = '4.0'): Promise<ODataServiceMetadata> {
    const metadataUrl = endpoint.endsWith('/') ? `${endpoint}$metadata` : `${endpoint}/$metadata`

    const response = await this.conn._request<string>(
      'GET',
      metadataUrl,
      undefined,
      { Accept: 'application/xml' }
    )

    // Parse XML metadata response
    return this.parseODataMetadata(response, version, endpoint)
  }

  /**
   * Execute OData query
   */
  async queryOData<T = unknown>(
    endpoint: string,
    entitySet: string,
    options?: ODataQueryOptions
  ): Promise<ODataResponse<T>> {
    const baseUrl = endpoint.endsWith('/') ? endpoint : `${endpoint}/`
    let url = `${baseUrl}${entitySet}`

    if (options) {
      const params = new URLSearchParams()
      if (options.$filter) params.set('$filter', options.$filter)
      if (options.$select) params.set('$select', options.$select)
      if (options.$expand) params.set('$expand', options.$expand)
      if (options.$orderby) params.set('$orderby', options.$orderby)
      if (options.$top !== undefined) params.set('$top', String(options.$top))
      if (options.$skip !== undefined) params.set('$skip', String(options.$skip))
      if (options.$count) params.set('$count', 'true')
      if (options.$search) params.set('$search', options.$search)

      const queryString = params.toString()
      if (queryString) {
        url += `?${queryString}`
      }
    }

    return this.conn._request<ODataResponse<T>>(
      'GET',
      url,
      undefined,
      { Accept: 'application/json' }
    )
  }

  /**
   * Create OData record
   */
  async createODataRecord<T = unknown>(
    endpoint: string,
    entitySet: string,
    data: Record<string, unknown>
  ): Promise<T> {
    const baseUrl = endpoint.endsWith('/') ? endpoint : `${endpoint}/`
    const url = `${baseUrl}${entitySet}`

    return this.conn._request<T>(
      'POST',
      url,
      data,
      { 'Content-Type': 'application/json', Accept: 'application/json' }
    )
  }

  /**
   * Update OData record
   */
  async updateODataRecord<T = unknown>(
    endpoint: string,
    entitySet: string,
    key: string,
    data: Record<string, unknown>
  ): Promise<T> {
    const baseUrl = endpoint.endsWith('/') ? endpoint : `${endpoint}/`
    const url = `${baseUrl}${entitySet}('${key}')`

    return this.conn._request<T>(
      'PATCH',
      url,
      data,
      { 'Content-Type': 'application/json', Accept: 'application/json' }
    )
  }

  /**
   * Delete OData record
   */
  async deleteODataRecord(
    endpoint: string,
    entitySet: string,
    key: string
  ): Promise<void> {
    const baseUrl = endpoint.endsWith('/') ? endpoint : `${endpoint}/`
    const url = `${baseUrl}${entitySet}('${key}')`

    await this.conn._request<null>(
      'DELETE',
      url,
      undefined,
      { Accept: 'application/json' }
    )
  }

  // ===========================================================================
  // Cross-Org Sync Operations
  // ===========================================================================

  /**
   * Configure cross-org adapter
   */
  async configureCrossOrgAdapter(config: CrossOrgAdapterConfig): Promise<SaveResult> {
    const dataSourceConfig: ExternalDataSourceConfig = {
      developerName: `CrossOrg_${Date.now()}`,
      label: `Cross-Org: ${config.sourceOrgUrl}`,
      type: 'CrossOrg',
      endpoint: config.sourceOrgUrl,
      authenticationProtocol: 'OAuth',
      identityType: 'NamedUser',
      namedCredential: config.sourceOrgCredential,
      isWritable: config.syncDirection !== 'SourceToTarget',
    }

    return this.createDataSource(dataSourceConfig)
  }

  /**
   * Get cross-org sync status for objects
   */
  async getCrossOrgSyncStatus(dataSourceId: string): Promise<CrossOrgSyncStatus[]> {
    // Query external object sync status
    const result = await this.conn.query<{
      ExternalObjectName: string
      LastSyncDateTime: string
      SyncStatus: string
      RecordsSynced: number
      RecordsFailed: number
      ErrorMessage: string
    }>(
      `SELECT ExternalObjectName, LastSyncDateTime, SyncStatus, RecordsSynced, RecordsFailed, ErrorMessage ` +
      `FROM ExternalObjectSyncLog WHERE ExternalDataSourceId = '${dataSourceId}' ORDER BY LastSyncDateTime DESC`
    ).catch(() => ({ records: [] })) // Table may not exist

    return result.records.map(record => ({
      objectName: record.ExternalObjectName,
      lastSyncTime: record.LastSyncDateTime,
      recordsSynced: record.RecordsSynced,
      recordsFailed: record.RecordsFailed,
      status: record.SyncStatus as CrossOrgSyncStatus['status'],
      errorMessage: record.ErrorMessage,
    }))
  }

  /**
   * Trigger manual sync for cross-org data
   */
  async triggerCrossOrgSync(dataSourceId: string, objectNames?: string[]): Promise<{ syncId: string; status: string }> {
    const body: Record<string, unknown> = {
      externalDataSourceId: dataSourceId,
    }

    if (objectNames?.length) {
      body.objectNames = objectNames
    }

    return this.conn._request<{ syncId: string; status: string }>(
      'POST',
      `${this.conn.instanceUrl}/services/data/v${this.conn.version}/connect/external-data-sources/${dataSourceId}/sync`,
      body
    )
  }

  // ===========================================================================
  // Indirect Lookup Relationships
  // ===========================================================================

  /**
   * Create indirect lookup relationship between external object and standard object
   */
  async createIndirectLookup(
    externalObjectName: string,
    targetObject: string,
    externalIdField: string,
    relationshipName: string
  ): Promise<SaveResult> {
    const fieldMetadata = {
      fullName: `${externalObjectName}.${relationshipName}__c`,
      label: relationshipName,
      type: 'Lookup',
      referenceTo: targetObject,
      relationshipName: relationshipName.replace(/__c$/, ''),
      lookupFilter: {
        active: true,
        filterItems: [{
          field: `${targetObject}.${externalIdField}`,
          operation: 'equals',
          valueField: `${externalObjectName}.ExternalId`,
        }],
      },
    }

    return this.conn._request<SaveResult>(
      'POST',
      `${this.conn.instanceUrl}/services/Soap/m/${this.conn.version}`,
      { type: 'CustomField', metadata: fieldMetadata }
    )
  }

  /**
   * Create external lookup relationship
   */
  async createExternalLookup(
    sourceObject: string,
    externalObjectName: string,
    fieldName: string,
    externalIdField: string
  ): Promise<SaveResult> {
    const fieldMetadata = {
      fullName: `${sourceObject}.${fieldName}`,
      label: fieldName.replace(/__c$/, '').replace(/_/g, ' '),
      type: 'ExternalLookup',
      referenceTo: externalObjectName,
      externalIdField: externalIdField,
    }

    return this.conn._request<SaveResult>(
      'POST',
      `${this.conn.instanceUrl}/services/Soap/m/${this.conn.version}`,
      { type: 'CustomField', metadata: fieldMetadata }
    )
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Parse OData metadata XML into structured format
   */
  private parseODataMetadata(xml: string, version: ODataVersion, serviceRoot: string): ODataServiceMetadata {
    // Simplified XML parsing - in production, use a proper XML parser
    const entitySets: ODataEntitySet[] = []
    const entityTypes: ODataEntityType[] = []

    // Extract entity sets
    const entitySetMatches = xml.matchAll(/<EntitySet[^>]+Name="([^"]+)"[^>]+EntityType="([^"]+)"[^>]*\/>/g)
    for (const match of entitySetMatches) {
      entitySets.push({
        name: match[1],
        entityType: match[2],
        url: `${serviceRoot}/${match[1]}`,
      })
    }

    // Extract entity types (simplified)
    const entityTypeMatches = xml.matchAll(/<EntityType[^>]+Name="([^"]+)"[^>]*>([\s\S]*?)<\/EntityType>/g)
    for (const match of entityTypeMatches) {
      const typeName = match[1]
      const typeContent = match[2]

      const properties: ODataProperty[] = []
      const keyFields: string[] = []

      // Extract key
      const keyMatch = typeContent.match(/<Key>([\s\S]*?)<\/Key>/)
      if (keyMatch) {
        const keyRefMatches = keyMatch[1].matchAll(/<PropertyRef[^>]+Name="([^"]+)"[^>]*\/>/g)
        for (const keyRef of keyRefMatches) {
          keyFields.push(keyRef[1])
        }
      }

      // Extract properties
      const propMatches = typeContent.matchAll(/<Property[^>]+Name="([^"]+)"[^>]+Type="([^"]+)"[^>]*\/>/g)
      for (const propMatch of propMatches) {
        properties.push({
          name: propMatch[1],
          type: propMatch[2],
        })
      }

      entityTypes.push({
        name: typeName,
        properties,
        key: keyFields,
      })
    }

    return {
      version,
      serviceRoot,
      entitySets,
      entityTypes,
    }
  }
}

// =============================================================================
// External Object Helpers
// =============================================================================

/**
 * Check if an object name is an external object
 */
export function isExternalObject(objectName: string): boolean {
  return objectName.endsWith('__x')
}

/**
 * Convert standard object name to external object name
 */
export function toExternalObjectName(objectName: string): string {
  if (objectName.endsWith('__x')) return objectName
  if (objectName.endsWith('__c')) return objectName.replace(/__c$/, '__x')
  return `${objectName}__x`
}

/**
 * Convert external object name to standard naming
 */
export function fromExternalObjectName(objectName: string): string {
  return objectName.replace(/__x$/, '')
}

// =============================================================================
// OData Query Builder
// =============================================================================

/**
 * Fluent builder for OData queries
 */
export class ODataQueryBuilder {
  private entitySet: string
  private options: ODataQueryOptions = {}

  constructor(entitySet: string) {
    this.entitySet = entitySet
  }

  /**
   * Select specific fields
   */
  select(...fields: string[]): this {
    this.options.$select = fields.join(',')
    return this
  }

  /**
   * Filter records
   */
  filter(expression: string): this {
    this.options.$filter = expression
    return this
  }

  /**
   * Expand related entities
   */
  expand(...relations: string[]): this {
    this.options.$expand = relations.join(',')
    return this
  }

  /**
   * Order by field(s)
   */
  orderBy(expression: string): this {
    this.options.$orderby = expression
    return this
  }

  /**
   * Limit number of records
   */
  top(count: number): this {
    this.options.$top = count
    return this
  }

  /**
   * Skip records
   */
  skip(count: number): this {
    this.options.$skip = count
    return this
  }

  /**
   * Include count in response
   */
  count(): this {
    this.options.$count = true
    return this
  }

  /**
   * Full-text search
   */
  search(term: string): this {
    this.options.$search = term
    return this
  }

  /**
   * Build the query options
   */
  build(): ODataQueryOptions {
    return { ...this.options }
  }

  /**
   * Get entity set name
   */
  getEntitySet(): string {
    return this.entitySet
  }
}

/**
 * Create OData query builder
 */
export function odata(entitySet: string): ODataQueryBuilder {
  return new ODataQueryBuilder(entitySet)
}

// =============================================================================
// Type-safe External Object Factory
// =============================================================================

/**
 * Create a type-safe external object interface
 */
export function defineExternalObject<T extends ExternalObject>(
  name: string,
  fields: ExternalObjectField[]
): ExternalObjectDefinition & { fields: ExternalObjectField[] } {
  const externalName = toExternalObjectName(name)

  return {
    name: externalName,
    label: name.replace(/__x$/, '').replace(/_/g, ' '),
    labelPlural: name.replace(/__x$/, '').replace(/_/g, ' ') + 's',
    externalDataSourceId: '',
    externalTableName: name,
    fields,
  }
}

export default Connect
