/**
 * @dotdo/hubspot - HubSpot API Compatibility Layer
 *
 * Drop-in replacement for @hubspot/api-client SDK with edge compatibility.
 *
 * @example
 * ```typescript
 * import { Client } from '@dotdo/hubspot'
 *
 * const hubspot = new Client({ accessToken: 'pat-xxx' })
 *
 * // Create a contact
 * const contact = await hubspot.crm.contacts.basicApi.create({
 *   properties: {
 *     email: 'user@example.com',
 *     firstname: 'John',
 *     lastname: 'Doe',
 *   },
 * })
 *
 * // Search contacts
 * const results = await hubspot.crm.contacts.searchApi.doSearch({
 *   filterGroups: [{
 *     filters: [{ propertyName: 'email', operator: 'CONTAINS_TOKEN', value: '@example.com' }],
 *   }],
 * })
 * ```
 *
 * @module @dotdo/hubspot
 */

import type {
  ClientConfig,
  RequestOptions,
  FetchFunction,
  CrmObject,
  Contact,
  ContactCreateInput,
  ContactUpdateInput,
  Company,
  CompanyCreateInput,
  CompanyUpdateInput,
  Deal,
  DealCreateInput,
  DealUpdateInput,
  Ticket,
  TicketCreateInput,
  TicketUpdateInput,
  LineItem,
  LineItemCreateInput,
  LineItemUpdateInput,
  Product,
  ProductCreateInput,
  ProductUpdateInput,
  Quote,
  QuoteCreateInput,
  QuoteUpdateInput,
  Owner,
  PropertyDefinition,
  PropertyCreateInput,
  PropertyUpdateInput,
  PropertyGroup,
  PropertyGroupCreateInput,
  ObjectSchema,
  ObjectSchemaCreateInput,
  ObjectSchemaUpdateInput,
  Note,
  Email,
  Call,
  Meeting,
  EngagementCreateInput,
  Pipeline,
  PipelineStage,
  Association,
  AssociationResult,
  AssociationSpec,
  BatchAssociationInput,
  BatchAssociationResult,
  SearchRequest,
  SearchResult,
  CollectionResponse,
  BatchResult,
  BatchReadInput,
  BatchCreateInput,
  BatchUpdateInput,
  BatchArchiveInput,
  HubSpotErrorDetail,
} from './types'

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BASE_PATH = 'https://api.hubapi.com'

// =============================================================================
// HubSpot Error Class
// =============================================================================

/**
 * HubSpot API Error
 */
export class HubSpotError extends Error {
  category: string
  statusCode: number
  correlationId?: string
  subCategory?: string
  context?: Record<string, string[]>
  links?: Record<string, string>

  constructor(detail: HubSpotErrorDetail, statusCode: number) {
    super(detail.message)
    this.name = 'HubSpotError'
    this.category = detail.category
    this.statusCode = statusCode
    this.correlationId = detail.correlationId
    this.subCategory = detail.subCategory
    this.context = detail.context
    this.links = detail.links
  }
}

// =============================================================================
// Base Resource Class
// =============================================================================

/**
 * Base class for HubSpot API resources
 */
abstract class HubSpotResource {
  protected client: Client

  constructor(client: Client) {
    this.client = client
  }

  protected request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    params?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    return this.client._request(method, path, params as Record<string, unknown> | undefined, options)
  }
}

// =============================================================================
// Basic API Resource
// =============================================================================

/**
 * Basic CRUD API for CRM objects
 */
class BasicApi<
  T extends CrmObject,
  TCreate extends { properties: Record<string, string> },
  TUpdate extends { properties: Record<string, string> }
> extends HubSpotResource {
  protected objectType: string

  constructor(client: Client, objectType: string) {
    super(client)
    this.objectType = objectType
  }

  /**
   * Create a new object
   */
  async create(input: TCreate, options?: RequestOptions): Promise<T> {
    return this.request('POST', `/crm/v3/objects/${this.objectType}`, input, options)
  }

  /**
   * Get object by ID
   */
  async getById(id: string, properties?: string[], options?: RequestOptions): Promise<T> {
    const query = properties?.length ? `?properties=${properties.join(',')}` : ''
    return this.request('GET', `/crm/v3/objects/${this.objectType}/${id}${query}`, undefined, options)
  }

  /**
   * Update an object
   */
  async update(id: string, input: TUpdate, options?: RequestOptions): Promise<T> {
    return this.request('PATCH', `/crm/v3/objects/${this.objectType}/${id}`, input, options)
  }

  /**
   * Archive (soft delete) an object
   */
  async archive(id: string, options?: RequestOptions): Promise<void> {
    await this.request('DELETE', `/crm/v3/objects/${this.objectType}/${id}`, undefined, options)
  }

  /**
   * Get a page of objects
   */
  async getPage(
    limit?: number,
    after?: string,
    properties?: string[],
    options?: RequestOptions
  ): Promise<CollectionResponse<T>> {
    const params = new URLSearchParams()
    if (limit) params.set('limit', String(limit))
    if (after) params.set('after', after)
    if (properties?.length) params.set('properties', properties.join(','))
    const query = params.toString() ? `?${params}` : ''
    return this.request('GET', `/crm/v3/objects/${this.objectType}${query}`, undefined, options)
  }
}

// =============================================================================
// Search API Resource
// =============================================================================

/**
 * Search API for CRM objects
 */
class SearchApi<T extends CrmObject> extends HubSpotResource {
  protected objectType: string

  constructor(client: Client, objectType: string) {
    super(client)
    this.objectType = objectType
  }

  /**
   * Search for objects
   */
  async doSearch(request: SearchRequest, options?: RequestOptions): Promise<SearchResult<T>> {
    return this.request('POST', `/crm/v3/objects/${this.objectType}/search`, request, options)
  }
}

// =============================================================================
// Batch API Resource
// =============================================================================

/**
 * Batch API for CRM objects
 */
class BatchApi<
  T extends CrmObject,
  TCreate extends { properties: Record<string, string> }
> extends HubSpotResource {
  protected objectType: string

  constructor(client: Client, objectType: string) {
    super(client)
    this.objectType = objectType
  }

  /**
   * Batch create objects
   */
  async create(input: BatchCreateInput<TCreate>, options?: RequestOptions): Promise<BatchResult<T>> {
    return this.request('POST', `/crm/v3/objects/${this.objectType}/batch/create`, input, options)
  }

  /**
   * Batch read objects
   */
  async read(input: BatchReadInput, options?: RequestOptions): Promise<BatchResult<T>> {
    return this.request('POST', `/crm/v3/objects/${this.objectType}/batch/read`, input, options)
  }

  /**
   * Batch update objects
   */
  async update(input: BatchUpdateInput, options?: RequestOptions): Promise<BatchResult<T>> {
    return this.request('POST', `/crm/v3/objects/${this.objectType}/batch/update`, input, options)
  }

  /**
   * Batch archive objects
   */
  async archive(input: BatchArchiveInput, options?: RequestOptions): Promise<void> {
    await this.request('POST', `/crm/v3/objects/${this.objectType}/batch/archive`, input, options)
  }
}

// =============================================================================
// CRM Object Resource (combines Basic, Search, Batch APIs)
// =============================================================================

/**
 * CRM object resource with basic, search, and batch APIs
 */
class CrmObjectResource<
  T extends CrmObject,
  TCreate extends { properties: Record<string, string> },
  TUpdate extends { properties: Record<string, string> }
> {
  readonly basicApi: BasicApi<T, TCreate, TUpdate>
  readonly searchApi: SearchApi<T>
  readonly batchApi: BatchApi<T, TCreate>

  constructor(client: Client, objectType: string) {
    this.basicApi = new BasicApi<T, TCreate, TUpdate>(client, objectType)
    this.searchApi = new SearchApi<T>(client, objectType)
    this.batchApi = new BatchApi<T, TCreate>(client, objectType)
  }
}

// =============================================================================
// Pipeline Resources
// =============================================================================

/**
 * Pipelines API
 */
class PipelinesApi extends HubSpotResource {
  /**
   * Get all pipelines for an object type
   */
  async getAll(objectType: string, options?: RequestOptions): Promise<CollectionResponse<Pipeline>> {
    return this.request('GET', `/crm/v3/pipelines/${objectType}`, undefined, options)
  }

  /**
   * Get a pipeline by ID
   */
  async getById(objectType: string, pipelineId: string, options?: RequestOptions): Promise<Pipeline> {
    return this.request('GET', `/crm/v3/pipelines/${objectType}/${pipelineId}`, undefined, options)
  }

  /**
   * Create a pipeline
   */
  async create(
    objectType: string,
    input: { label: string; displayOrder: number; stages: Array<{ label: string; displayOrder: number; metadata?: Record<string, string> }> },
    options?: RequestOptions
  ): Promise<Pipeline> {
    return this.request('POST', `/crm/v3/pipelines/${objectType}`, input, options)
  }

  /**
   * Update a pipeline
   */
  async update(
    objectType: string,
    pipelineId: string,
    input: { label?: string; displayOrder?: number },
    options?: RequestOptions
  ): Promise<Pipeline> {
    return this.request('PATCH', `/crm/v3/pipelines/${objectType}/${pipelineId}`, input, options)
  }

  /**
   * Delete a pipeline
   */
  async archive(objectType: string, pipelineId: string, options?: RequestOptions): Promise<void> {
    await this.request('DELETE', `/crm/v3/pipelines/${objectType}/${pipelineId}`, undefined, options)
  }
}

/**
 * Pipeline Stages API
 */
class PipelineStagesApi extends HubSpotResource {
  /**
   * Get all stages for a pipeline
   */
  async getAll(
    objectType: string,
    pipelineId: string,
    options?: RequestOptions
  ): Promise<CollectionResponse<PipelineStage>> {
    return this.request('GET', `/crm/v3/pipelines/${objectType}/${pipelineId}/stages`, undefined, options)
  }

  /**
   * Get a stage by ID
   */
  async getById(
    objectType: string,
    pipelineId: string,
    stageId: string,
    options?: RequestOptions
  ): Promise<PipelineStage> {
    return this.request('GET', `/crm/v3/pipelines/${objectType}/${pipelineId}/stages/${stageId}`, undefined, options)
  }

  /**
   * Create a stage
   */
  async create(
    objectType: string,
    pipelineId: string,
    input: { label: string; displayOrder: number; metadata?: Record<string, string> },
    options?: RequestOptions
  ): Promise<PipelineStage> {
    return this.request('POST', `/crm/v3/pipelines/${objectType}/${pipelineId}/stages`, input, options)
  }

  /**
   * Update a stage
   */
  async update(
    objectType: string,
    pipelineId: string,
    stageId: string,
    input: { label?: string; displayOrder?: number; metadata?: Record<string, string> },
    options?: RequestOptions
  ): Promise<PipelineStage> {
    return this.request(
      'PATCH',
      `/crm/v3/pipelines/${objectType}/${pipelineId}/stages/${stageId}`,
      input,
      options
    )
  }

  /**
   * Delete a stage
   */
  async archive(
    objectType: string,
    pipelineId: string,
    stageId: string,
    options?: RequestOptions
  ): Promise<void> {
    await this.request(
      'DELETE',
      `/crm/v3/pipelines/${objectType}/${pipelineId}/stages/${stageId}`,
      undefined,
      options
    )
  }
}

/**
 * Pipelines resource container
 */
class PipelinesResource {
  readonly pipelinesApi: PipelinesApi
  readonly pipelineStagesApi: PipelineStagesApi

  constructor(client: Client) {
    this.pipelinesApi = new PipelinesApi(client)
    this.pipelineStagesApi = new PipelineStagesApi(client)
  }
}

// =============================================================================
// Associations Resources
// =============================================================================

/**
 * Associations Basic API (v4)
 */
class AssociationsBasicApi extends HubSpotResource {
  /**
   * Create an association between objects
   */
  async create(
    fromObjectType: string,
    fromObjectId: string,
    toObjectType: string,
    toObjectId: string,
    associationSpec: AssociationSpec[],
    options?: RequestOptions
  ): Promise<Association> {
    return this.request(
      'PUT',
      `/crm/v4/objects/${fromObjectType}/${fromObjectId}/associations/${toObjectType}/${toObjectId}`,
      associationSpec,
      options
    )
  }

  /**
   * Get associations for an object
   */
  async getPage(
    fromObjectType: string,
    fromObjectId: string,
    toObjectType: string,
    limit?: number,
    after?: string,
    options?: RequestOptions
  ): Promise<AssociationResult> {
    const params = new URLSearchParams()
    if (limit) params.set('limit', String(limit))
    if (after) params.set('after', after)
    const query = params.toString() ? `?${params}` : ''
    return this.request(
      'GET',
      `/crm/v4/objects/${fromObjectType}/${fromObjectId}/associations/${toObjectType}${query}`,
      undefined,
      options
    )
  }

  /**
   * Delete an association
   */
  async archive(
    fromObjectType: string,
    fromObjectId: string,
    toObjectType: string,
    toObjectId: string,
    options?: RequestOptions
  ): Promise<void> {
    await this.request(
      'DELETE',
      `/crm/v4/objects/${fromObjectType}/${fromObjectId}/associations/${toObjectType}/${toObjectId}`,
      undefined,
      options
    )
  }
}

/**
 * Associations Batch API (v4)
 */
class AssociationsBatchApi extends HubSpotResource {
  /**
   * Batch create associations
   */
  async create(
    fromObjectType: string,
    toObjectType: string,
    input: BatchAssociationInput,
    options?: RequestOptions
  ): Promise<BatchAssociationResult> {
    return this.request(
      'POST',
      `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/create`,
      input,
      options
    )
  }

  /**
   * Batch read associations
   */
  async read(
    fromObjectType: string,
    toObjectType: string,
    input: { inputs: Array<{ id: string }> },
    options?: RequestOptions
  ): Promise<BatchAssociationResult> {
    return this.request(
      'POST',
      `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read`,
      input,
      options
    )
  }

  /**
   * Batch delete associations
   */
  async archive(
    fromObjectType: string,
    toObjectType: string,
    input: { inputs: Array<{ from: { id: string }; to: { id: string } }> },
    options?: RequestOptions
  ): Promise<void> {
    await this.request(
      'POST',
      `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/archive`,
      input,
      options
    )
  }
}

/**
 * Associations V4 container
 */
class AssociationsV4 {
  readonly basicApi: AssociationsBasicApi
  readonly batchApi: AssociationsBatchApi

  constructor(client: Client) {
    this.basicApi = new AssociationsBasicApi(client)
    this.batchApi = new AssociationsBatchApi(client)
  }
}

/**
 * Associations resource container
 */
class AssociationsResource {
  readonly v4: AssociationsV4

  constructor(client: Client) {
    this.v4 = new AssociationsV4(client)
  }
}

// =============================================================================
// Owners API
// =============================================================================

/**
 * Owners API for managing HubSpot users/owners
 */
class OwnersApi extends HubSpotResource {
  /**
   * Get all owners
   */
  async getPage(
    email?: string,
    after?: string,
    limit?: number,
    options?: RequestOptions
  ): Promise<CollectionResponse<Owner>> {
    const params = new URLSearchParams()
    if (email) params.set('email', email)
    if (after) params.set('after', after)
    if (limit) params.set('limit', String(limit))
    const query = params.toString() ? `?${params}` : ''
    return this.request('GET', `/crm/v3/owners${query}`, undefined, options)
  }

  /**
   * Get an owner by ID
   */
  async getById(ownerId: string, options?: RequestOptions): Promise<Owner> {
    return this.request('GET', `/crm/v3/owners/${ownerId}`, undefined, options)
  }
}

// =============================================================================
// Properties API
// =============================================================================

/**
 * Properties Core API for managing object properties
 */
class PropertiesCoreApi extends HubSpotResource {
  /**
   * Get all properties for an object type
   */
  async getAll(objectType: string, options?: RequestOptions): Promise<CollectionResponse<PropertyDefinition>> {
    return this.request('GET', `/crm/v3/properties/${objectType}`, undefined, options)
  }

  /**
   * Get a single property
   */
  async getByName(objectType: string, propertyName: string, options?: RequestOptions): Promise<PropertyDefinition> {
    return this.request('GET', `/crm/v3/properties/${objectType}/${propertyName}`, undefined, options)
  }

  /**
   * Create a property
   */
  async create(objectType: string, input: PropertyCreateInput, options?: RequestOptions): Promise<PropertyDefinition> {
    return this.request('POST', `/crm/v3/properties/${objectType}`, input, options)
  }

  /**
   * Update a property
   */
  async update(
    objectType: string,
    propertyName: string,
    input: PropertyUpdateInput,
    options?: RequestOptions
  ): Promise<PropertyDefinition> {
    return this.request('PATCH', `/crm/v3/properties/${objectType}/${propertyName}`, input, options)
  }

  /**
   * Archive a property
   */
  async archive(objectType: string, propertyName: string, options?: RequestOptions): Promise<void> {
    await this.request('DELETE', `/crm/v3/properties/${objectType}/${propertyName}`, undefined, options)
  }
}

/**
 * Property Groups API
 */
class PropertyGroupsApi extends HubSpotResource {
  /**
   * Get all property groups for an object type
   */
  async getAll(objectType: string, options?: RequestOptions): Promise<CollectionResponse<PropertyGroup>> {
    return this.request('GET', `/crm/v3/properties/${objectType}/groups`, undefined, options)
  }

  /**
   * Get a single property group
   */
  async getByName(objectType: string, groupName: string, options?: RequestOptions): Promise<PropertyGroup> {
    return this.request('GET', `/crm/v3/properties/${objectType}/groups/${groupName}`, undefined, options)
  }

  /**
   * Create a property group
   */
  async create(objectType: string, input: PropertyGroupCreateInput, options?: RequestOptions): Promise<PropertyGroup> {
    return this.request('POST', `/crm/v3/properties/${objectType}/groups`, input, options)
  }

  /**
   * Update a property group
   */
  async update(
    objectType: string,
    groupName: string,
    input: Partial<PropertyGroupCreateInput>,
    options?: RequestOptions
  ): Promise<PropertyGroup> {
    return this.request('PATCH', `/crm/v3/properties/${objectType}/groups/${groupName}`, input, options)
  }

  /**
   * Archive a property group
   */
  async archive(objectType: string, groupName: string, options?: RequestOptions): Promise<void> {
    await this.request('DELETE', `/crm/v3/properties/${objectType}/groups/${groupName}`, undefined, options)
  }
}

/**
 * Properties resource container
 */
class PropertiesResource {
  readonly coreApi: PropertiesCoreApi
  readonly groupsApi: PropertyGroupsApi

  constructor(client: Client) {
    this.coreApi = new PropertiesCoreApi(client)
    this.groupsApi = new PropertyGroupsApi(client)
  }
}

// =============================================================================
// Schemas API (Custom Objects)
// =============================================================================

/**
 * Schemas Core API for managing custom object schemas
 */
class SchemasCoreApi extends HubSpotResource {
  /**
   * Get all schemas
   */
  async getAll(options?: RequestOptions): Promise<CollectionResponse<ObjectSchema>> {
    return this.request('GET', '/crm/v3/schemas', undefined, options)
  }

  /**
   * Get a schema by object type
   */
  async getById(objectType: string, options?: RequestOptions): Promise<ObjectSchema> {
    return this.request('GET', `/crm/v3/schemas/${objectType}`, undefined, options)
  }

  /**
   * Create a custom object schema
   */
  async create(input: ObjectSchemaCreateInput, options?: RequestOptions): Promise<ObjectSchema> {
    return this.request('POST', '/crm/v3/schemas', input, options)
  }

  /**
   * Update a schema
   */
  async update(objectType: string, input: ObjectSchemaUpdateInput, options?: RequestOptions): Promise<ObjectSchema> {
    return this.request('PATCH', `/crm/v3/schemas/${objectType}`, input, options)
  }

  /**
   * Delete a schema (only for portal-specific schemas)
   */
  async archive(objectType: string, options?: RequestOptions): Promise<void> {
    await this.request('DELETE', `/crm/v3/schemas/${objectType}`, undefined, options)
  }
}

/**
 * Schemas resource container
 */
class SchemasResource {
  readonly coreApi: SchemasCoreApi

  constructor(client: Client) {
    this.coreApi = new SchemasCoreApi(client)
  }
}

// =============================================================================
// Objects Resource (Notes, Emails, Calls, Meetings, Line Items, Products, Quotes)
// =============================================================================

/**
 * Objects resource for engagement types and commerce objects
 */
class ObjectsResource {
  readonly notes: CrmObjectResource<Note, EngagementCreateInput, { properties: Record<string, string> }>
  readonly emails: CrmObjectResource<Email, EngagementCreateInput, { properties: Record<string, string> }>
  readonly calls: CrmObjectResource<Call, EngagementCreateInput, { properties: Record<string, string> }>
  readonly meetings: CrmObjectResource<Meeting, EngagementCreateInput, { properties: Record<string, string> }>

  constructor(client: Client) {
    this.notes = new CrmObjectResource(client, 'notes')
    this.emails = new CrmObjectResource(client, 'emails')
    this.calls = new CrmObjectResource(client, 'calls')
    this.meetings = new CrmObjectResource(client, 'meetings')
  }
}

// =============================================================================
// CRM Resource Container
// =============================================================================

/**
 * CRM resource container
 */
class CrmResource {
  // Core CRM objects
  readonly contacts: CrmObjectResource<Contact, ContactCreateInput, ContactUpdateInput>
  readonly companies: CrmObjectResource<Company, CompanyCreateInput, CompanyUpdateInput>
  readonly deals: CrmObjectResource<Deal, DealCreateInput, DealUpdateInput>
  readonly tickets: CrmObjectResource<Ticket, TicketCreateInput, TicketUpdateInput>

  // Commerce objects
  readonly lineItems: CrmObjectResource<LineItem, LineItemCreateInput, LineItemUpdateInput>
  readonly products: CrmObjectResource<Product, ProductCreateInput, ProductUpdateInput>
  readonly quotes: CrmObjectResource<Quote, QuoteCreateInput, QuoteUpdateInput>

  // Supporting APIs
  readonly pipelines: PipelinesResource
  readonly associations: AssociationsResource
  readonly objects: ObjectsResource
  readonly owners: OwnersApi
  readonly properties: PropertiesResource
  readonly schemas: SchemasResource

  constructor(client: Client) {
    // Core CRM objects
    this.contacts = new CrmObjectResource(client, 'contacts')
    this.companies = new CrmObjectResource(client, 'companies')
    this.deals = new CrmObjectResource(client, 'deals')
    this.tickets = new CrmObjectResource(client, 'tickets')

    // Commerce objects
    this.lineItems = new CrmObjectResource(client, 'line_items')
    this.products = new CrmObjectResource(client, 'products')
    this.quotes = new CrmObjectResource(client, 'quotes')

    // Supporting APIs
    this.pipelines = new PipelinesResource(client)
    this.associations = new AssociationsResource(client)
    this.objects = new ObjectsResource(client)
    this.owners = new OwnersApi(client)
    this.properties = new PropertiesResource(client)
    this.schemas = new SchemasResource(client)
  }
}

// =============================================================================
// Main Client
// =============================================================================

/**
 * HubSpot client for API interactions
 *
 * @example
 * ```typescript
 * const hubspot = new Client({ accessToken: 'pat-xxx' })
 *
 * // Create contact
 * const contact = await hubspot.crm.contacts.basicApi.create({
 *   properties: { email: 'user@example.com' }
 * })
 *
 * // Search
 * const results = await hubspot.crm.contacts.searchApi.doSearch({
 *   filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: 'user@example.com' }] }]
 * })
 * ```
 */
export class Client {
  private accessToken: string
  private basePath: string
  private defaultHeaders: Record<string, string>
  private _fetch: typeof fetch | FetchFunction

  // Resources
  readonly crm: CrmResource

  constructor(config: ClientConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required')
    }

    this.accessToken = config.accessToken
    this.basePath = config.basePath ?? DEFAULT_BASE_PATH
    this.defaultHeaders = config.defaultHeaders ?? {}
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)

    // Initialize resources
    this.crm = new CrmResource(this)
  }

  /**
   * Make a raw API request
   * @internal
   */
  async _request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<T> {
    const url = new URL(path, this.basePath)

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...this.defaultHeaders,
      ...options?.headers,
    }

    // Build request body for POST/PUT/PATCH with params
    let body: string | undefined
    if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && params) {
      body = JSON.stringify(params)
    }

    const response = await this._fetch(url.toString(), {
      method,
      headers,
      body,
    })

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return null as T
    }

    // Handle 201 Created with body
    if (response.status === 201) {
      const data = await response.json()
      return data as T
    }

    const data = await response.json()

    if (!response.ok) {
      const errorDetail = data as HubSpotErrorDetail
      throw new HubSpotError(errorDetail, response.status)
    }

    return data as T
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default { Client }
