/**
 * @dotdo/hubspot - HubSpot API Client
 *
 * Drop-in replacement for @hubspot/api-client with edge compatibility.
 * Provides the same interface patterns for seamless migration.
 */

import type {
  ClientConfig,
  Contact,
  Company,
  Deal,
  Ticket,
  Engagement,
  LineItem,
  Product,
  Quote,
  Owner,
  Association,
  AssociationType,
  AssociationResult,
  Pipeline,
  Property,
  PropertyGroup,
  Schema,
  SearchRequest,
  SearchResult,
  BatchCreateInput,
  BatchReadInput,
  BatchUpdateInput,
  BatchArchiveInput,
  BatchResult,
  ListResult,
  CreateInput,
  UpdateInput,
  CRMObject,
  HubSpotErrorResponse,
} from './types'

// =============================================================================
// Error Class
// =============================================================================

/**
 * HubSpot API error
 */
export class HubSpotError extends Error {
  category: string
  statusCode: number
  correlationId: string
  context?: Record<string, unknown>

  constructor(
    message: string,
    category: string,
    statusCode: number,
    correlationId?: string,
    context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'HubSpotError'
    this.category = category
    this.statusCode = statusCode
    this.correlationId = correlationId ?? generateId('correlation')
    this.context = context
  }
}

// =============================================================================
// Utilities
// =============================================================================

function generateId(prefix: string = 'id'): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

// =============================================================================
// HTTP Client
// =============================================================================

class HttpClient {
  private accessToken: string
  private basePath: string
  private fetchFn: typeof fetch

  constructor(config: ClientConfig) {
    this.accessToken = config.accessToken
    this.basePath = config.basePath ?? 'https://api.hubapi.com'
    this.fetchFn = config.fetch ?? globalThis.fetch
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | string[]>
  ): Promise<T> {
    let url = `${this.basePath}${path}`

    if (query) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) {
        if (Array.isArray(value)) {
          value.forEach(v => params.append(key, v))
        } else {
          params.append(key, value)
        }
      }
      const queryString = params.toString()
      if (queryString) {
        url += `?${queryString}`
      }
    }

    const response = await this.fetchFn(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const errorData = await response.json() as HubSpotErrorResponse
      throw new HubSpotError(
        errorData.message,
        errorData.category,
        response.status,
        errorData.correlationId,
        errorData.context
      )
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T
    }

    return await response.json() as T
  }

  get<T>(path: string, query?: Record<string, string | string[]>): Promise<T> {
    return this.request<T>('GET', path, undefined, query)
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body)
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }
}

// =============================================================================
// API Classes
// =============================================================================

/**
 * Basic API for CRUD operations on CRM objects
 */
class BasicApi<T extends CRMObject> {
  constructor(
    private http: HttpClient,
    private objectType: string
  ) {}

  async create(input: CreateInput<T>): Promise<T> {
    return this.http.post<T>(`/crm/v3/objects/${this.objectType}`, input)
  }

  async getById(id: string, properties?: string[], associations?: string[]): Promise<T> {
    const query: Record<string, string | string[]> = {}
    if (properties && properties.length > 0) {
      query.properties = properties
    }
    if (associations && associations.length > 0) {
      query.associations = associations
    }
    return this.http.get<T>(`/crm/v3/objects/${this.objectType}/${id}`, query)
  }

  async update(id: string, input: UpdateInput<T>): Promise<T> {
    return this.http.patch<T>(`/crm/v3/objects/${this.objectType}/${id}`, input)
  }

  async archive(id: string): Promise<void> {
    await this.http.delete<void>(`/crm/v3/objects/${this.objectType}/${id}`)
  }

  async getPage(options?: {
    limit?: number
    after?: string
    properties?: string[]
  }): Promise<ListResult<T>> {
    const query: Record<string, string | string[]> = {}
    if (options?.limit) query.limit = options.limit.toString()
    if (options?.after) query.after = options.after
    if (options?.properties) query.properties = options.properties
    return this.http.get<ListResult<T>>(`/crm/v3/objects/${this.objectType}`, query)
  }
}

/**
 * Search API for searching CRM objects
 */
class SearchApi<T extends CRMObject> {
  constructor(
    private http: HttpClient,
    private objectType: string
  ) {}

  async doSearch(request: SearchRequest): Promise<SearchResult<T>> {
    return this.http.post<SearchResult<T>>(`/crm/v3/objects/${this.objectType}/search`, request)
  }
}

/**
 * Batch API for batch operations on CRM objects
 */
class BatchApi<T extends CRMObject> {
  constructor(
    private http: HttpClient,
    private objectType: string
  ) {}

  async create(input: BatchCreateInput<T>): Promise<BatchResult<T>> {
    return this.http.post<BatchResult<T>>(`/crm/v3/objects/${this.objectType}/batch/create`, input)
  }

  async read(input: BatchReadInput): Promise<BatchResult<T>> {
    return this.http.post<BatchResult<T>>(`/crm/v3/objects/${this.objectType}/batch/read`, input)
  }

  async update(input: BatchUpdateInput<T>): Promise<BatchResult<T>> {
    return this.http.post<BatchResult<T>>(`/crm/v3/objects/${this.objectType}/batch/update`, input)
  }

  async archive(input: BatchArchiveInput): Promise<void> {
    await this.http.post<void>(`/crm/v3/objects/${this.objectType}/batch/archive`, input)
  }
}

/**
 * CRM Object API combining basic, search, and batch operations
 */
class CRMObjectApi<T extends CRMObject> {
  basicApi: BasicApi<T>
  searchApi: SearchApi<T>
  batchApi: BatchApi<T>

  constructor(http: HttpClient, objectType: string) {
    this.basicApi = new BasicApi<T>(http, objectType)
    this.searchApi = new SearchApi<T>(http, objectType)
    this.batchApi = new BatchApi<T>(http, objectType)
  }
}

/**
 * Associations V4 API
 */
class AssociationsV4Api {
  basicApi: AssociationsV4BasicApi
  batchApi: AssociationsV4BatchApi

  constructor(private http: HttpClient) {
    this.basicApi = new AssociationsV4BasicApi(http)
    this.batchApi = new AssociationsV4BatchApi(http)
  }
}

class AssociationsV4BasicApi {
  constructor(private http: HttpClient) {}

  async create(
    fromObjectType: string,
    fromObjectId: string,
    toObjectType: string,
    toObjectId: string,
    associationTypes: AssociationType[]
  ): Promise<Association> {
    return this.http.put<Association>(
      `/crm/v4/objects/${fromObjectType}/${fromObjectId}/associations/${toObjectType}/${toObjectId}`,
      associationTypes
    )
  }

  async getPage(
    fromObjectType: string,
    fromObjectId: string,
    toObjectType: string,
    options?: { limit?: number; after?: string }
  ): Promise<ListResult<AssociationResult>> {
    const query: Record<string, string> = {}
    if (options?.limit) query.limit = options.limit.toString()
    if (options?.after) query.after = options.after
    return this.http.get<ListResult<AssociationResult>>(
      `/crm/v4/objects/${fromObjectType}/${fromObjectId}/associations/${toObjectType}`,
      query
    )
  }

  async archive(
    fromObjectType: string,
    fromObjectId: string,
    toObjectType: string,
    toObjectId: string
  ): Promise<void> {
    await this.http.delete<void>(
      `/crm/v4/objects/${fromObjectType}/${fromObjectId}/associations/${toObjectType}/${toObjectId}`
    )
  }
}

class AssociationsV4BatchApi {
  constructor(private http: HttpClient) {}

  async create(
    fromObjectType: string,
    toObjectType: string,
    input: {
      inputs: Array<{
        from: { id: string }
        to: { id: string }
        types: AssociationType[]
      }>
    }
  ): Promise<BatchResult<{ from: { id: string }; to: { id: string }; type: string }>> {
    return this.http.post(
      `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/create`,
      input
    )
  }
}

/**
 * Associations API
 */
class AssociationsApi {
  v4: AssociationsV4Api

  constructor(http: HttpClient) {
    this.v4 = new AssociationsV4Api(http)
  }
}

/**
 * Pipelines API
 */
class PipelinesApi {
  pipelinesApi: PipelinesCoreApi
  pipelineStagesApi: PipelineStagesApi

  constructor(http: HttpClient) {
    this.pipelinesApi = new PipelinesCoreApi(http)
    this.pipelineStagesApi = new PipelineStagesApi(http)
  }
}

class PipelinesCoreApi {
  constructor(private http: HttpClient) {}

  async getAll(objectType: string): Promise<ListResult<Pipeline>> {
    return this.http.get<ListResult<Pipeline>>(`/crm/v3/pipelines/${objectType}`)
  }

  async getById(objectType: string, pipelineId: string): Promise<Pipeline> {
    return this.http.get<Pipeline>(`/crm/v3/pipelines/${objectType}/${pipelineId}`)
  }
}

class PipelineStagesApi {
  constructor(private http: HttpClient) {}

  async getAll(objectType: string, pipelineId: string): Promise<ListResult<Pipeline['stages'][0]>> {
    return this.http.get<ListResult<Pipeline['stages'][0]>>(
      `/crm/v3/pipelines/${objectType}/${pipelineId}/stages`
    )
  }
}

/**
 * Properties API
 */
class PropertiesApi {
  coreApi: PropertiesCoreApi
  groupsApi: PropertyGroupsApi

  constructor(http: HttpClient) {
    this.coreApi = new PropertiesCoreApi(http)
    this.groupsApi = new PropertyGroupsApi(http)
  }
}

class PropertiesCoreApi {
  constructor(private http: HttpClient) {}

  async getAll(objectType: string): Promise<ListResult<Property>> {
    return this.http.get<ListResult<Property>>(`/crm/v3/properties/${objectType}`)
  }

  async getByName(objectType: string, propertyName: string): Promise<Property> {
    return this.http.get<Property>(`/crm/v3/properties/${objectType}/${propertyName}`)
  }

  async create(objectType: string, input: Partial<Property>): Promise<Property> {
    return this.http.post<Property>(`/crm/v3/properties/${objectType}`, input)
  }

  async update(objectType: string, propertyName: string, input: Partial<Property>): Promise<Property> {
    return this.http.patch<Property>(`/crm/v3/properties/${objectType}/${propertyName}`, input)
  }

  async archive(objectType: string, propertyName: string): Promise<void> {
    await this.http.delete<void>(`/crm/v3/properties/${objectType}/${propertyName}`)
  }
}

class PropertyGroupsApi {
  constructor(private http: HttpClient) {}

  async getAll(objectType: string): Promise<ListResult<PropertyGroup>> {
    return this.http.get<ListResult<PropertyGroup>>(`/crm/v3/properties/${objectType}/groups`)
  }
}

/**
 * Schemas API (Custom Objects)
 */
class SchemasApi {
  coreApi: SchemasCoreApi

  constructor(http: HttpClient) {
    this.coreApi = new SchemasCoreApi(http)
  }
}

class SchemasCoreApi {
  constructor(private http: HttpClient) {}

  async getAll(): Promise<ListResult<Schema>> {
    return this.http.get<ListResult<Schema>>('/crm/v3/schemas')
  }

  async getById(objectType: string): Promise<Schema> {
    return this.http.get<Schema>(`/crm/v3/schemas/${objectType}`)
  }

  async create(input: Partial<Schema>): Promise<Schema> {
    return this.http.post<Schema>('/crm/v3/schemas', input)
  }

  async update(objectType: string, input: Partial<Schema>): Promise<Schema> {
    return this.http.patch<Schema>(`/crm/v3/schemas/${objectType}`, input)
  }

  async archive(objectType: string): Promise<void> {
    await this.http.delete<void>(`/crm/v3/schemas/${objectType}`)
  }
}

/**
 * Owners API
 */
class OwnersApi {
  constructor(private http: HttpClient) {}

  async getPage(options?: { limit?: number; after?: string }): Promise<ListResult<Owner>> {
    const query: Record<string, string> = {}
    if (options?.limit) query.limit = options.limit.toString()
    if (options?.after) query.after = options.after
    return this.http.get<ListResult<Owner>>('/crm/v3/owners', query)
  }

  async getById(ownerId: string): Promise<Owner> {
    return this.http.get<Owner>(`/crm/v3/owners/${ownerId}`)
  }
}

/**
 * CRM Objects (notes, emails, calls, meetings)
 */
class CRMObjectsApi {
  notes: CRMObjectApi<Engagement>
  emails: CRMObjectApi<Engagement>
  calls: CRMObjectApi<Engagement>
  meetings: CRMObjectApi<Engagement>

  constructor(http: HttpClient) {
    this.notes = new CRMObjectApi<Engagement>(http, 'notes')
    this.emails = new CRMObjectApi<Engagement>(http, 'emails')
    this.calls = new CRMObjectApi<Engagement>(http, 'calls')
    this.meetings = new CRMObjectApi<Engagement>(http, 'meetings')
  }
}

/**
 * CRM API
 */
class CRMApi {
  contacts: CRMObjectApi<Contact>
  companies: CRMObjectApi<Company>
  deals: CRMObjectApi<Deal>
  tickets: CRMObjectApi<Ticket>
  lineItems: CRMObjectApi<LineItem>
  products: CRMObjectApi<Product>
  quotes: CRMObjectApi<Quote>
  associations: AssociationsApi
  pipelines: PipelinesApi
  properties: PropertiesApi
  schemas: SchemasApi
  owners: OwnersApi
  objects: CRMObjectsApi

  constructor(http: HttpClient) {
    this.contacts = new CRMObjectApi<Contact>(http, 'contacts')
    this.companies = new CRMObjectApi<Company>(http, 'companies')
    this.deals = new CRMObjectApi<Deal>(http, 'deals')
    this.tickets = new CRMObjectApi<Ticket>(http, 'tickets')
    this.lineItems = new CRMObjectApi<LineItem>(http, 'line_items')
    this.products = new CRMObjectApi<Product>(http, 'products')
    this.quotes = new CRMObjectApi<Quote>(http, 'quotes')
    this.associations = new AssociationsApi(http)
    this.pipelines = new PipelinesApi(http)
    this.properties = new PropertiesApi(http)
    this.schemas = new SchemasApi(http)
    this.owners = new OwnersApi(http)
    this.objects = new CRMObjectsApi(http)
  }
}

// =============================================================================
// Main Client
// =============================================================================

/**
 * HubSpot API Client
 *
 * Drop-in replacement for @hubspot/api-client with edge compatibility.
 *
 * @example
 * ```typescript
 * import { Client } from '@dotdo/hubspot'
 *
 * const hubspot = new Client({ accessToken: 'pat-xxx' })
 *
 * // Create a contact
 * const contact = await hubspot.crm.contacts.basicApi.create({
 *   properties: { email: 'user@example.com', firstname: 'John' }
 * })
 *
 * // Search contacts
 * const results = await hubspot.crm.contacts.searchApi.doSearch({
 *   filterGroups: [{
 *     filters: [{ propertyName: 'email', operator: 'EQ', value: 'user@example.com' }]
 *   }]
 * })
 * ```
 */
export class Client {
  crm: CRMApi

  constructor(config: ClientConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required')
    }

    const http = new HttpClient(config)
    this.crm = new CRMApi(http)
  }
}
