/**
 * @dotdo/hubspot - Local Mock Backend
 *
 * In-memory HubSpot mock backend for local development and testing.
 * Provides the same interface as the Client but stores data in memory.
 */

import type {
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
} from './types'
import { HubSpotError } from './client'

// =============================================================================
// Utilities
// =============================================================================

function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

function now(): string {
  return new Date().toISOString()
}

// =============================================================================
// In-Memory Store
// =============================================================================

class InMemoryStore<T extends CRMObject> {
  private data: Map<string, T> = new Map()
  private objectType: string

  constructor(objectType: string) {
    this.objectType = objectType
  }

  create(properties: Record<string, string>): T {
    const id = generateId()
    const timestamp = now()
    const object = {
      id,
      properties: {
        ...properties,
        createdate: timestamp,
        lastmodifieddate: timestamp,
        hs_object_id: id,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    } as T
    this.data.set(id, object)
    return object
  }

  get(id: string): T | undefined {
    const object = this.data.get(id)
    if (object && !object.archived) {
      return object
    }
    return undefined
  }

  update(id: string, properties: Record<string, string>): T | undefined {
    const object = this.data.get(id)
    if (!object || object.archived) {
      return undefined
    }
    const timestamp = now()
    const updated = {
      ...object,
      properties: {
        ...object.properties,
        ...properties,
        lastmodifieddate: timestamp,
      },
      updatedAt: timestamp,
    }
    this.data.set(id, updated)
    return updated
  }

  archive(id: string): boolean {
    const object = this.data.get(id)
    if (!object || object.archived) {
      return false
    }
    const timestamp = now()
    object.archived = true
    object.archivedAt = timestamp
    return true
  }

  list(): T[] {
    return Array.from(this.data.values()).filter(obj => !obj.archived)
  }

  search(filters: SearchRequest['filterGroups']): T[] {
    const items = this.list()
    if (!filters || filters.length === 0) {
      return items
    }

    // Filter groups are OR'd together
    return items.filter(item => {
      // At least one filter group must match
      return filters.some(group => {
        // All filters in a group must match (AND)
        return group.filters.every(filter => {
          const value = item.properties[filter.propertyName]
          if (value === undefined) {
            return filter.operator === 'NOT_HAS_PROPERTY'
          }

          switch (filter.operator) {
            case 'EQ':
              return value === filter.value
            case 'NEQ':
              return value !== filter.value
            case 'CONTAINS_TOKEN':
              return value.includes(filter.value ?? '')
            case 'NOT_CONTAINS_TOKEN':
              return !value.includes(filter.value ?? '')
            case 'GT':
              return Number(value) > Number(filter.value)
            case 'GTE':
              return Number(value) >= Number(filter.value)
            case 'LT':
              return Number(value) < Number(filter.value)
            case 'LTE':
              return Number(value) <= Number(filter.value)
            case 'HAS_PROPERTY':
              return value !== undefined
            case 'NOT_HAS_PROPERTY':
              return value === undefined
            case 'IN':
              return filter.values?.includes(value) ?? false
            case 'NOT_IN':
              return !(filter.values?.includes(value) ?? false)
            default:
              return true
          }
        })
      })
    })
  }

  clear(): void {
    this.data.clear()
  }
}

// =============================================================================
// Local API Classes
// =============================================================================

class LocalBasicApi<T extends CRMObject> {
  constructor(
    private store: InMemoryStore<T>,
    private objectType: string
  ) {}

  async create(input: CreateInput<T>): Promise<T> {
    return this.store.create(input.properties as Record<string, string>)
  }

  async getById(id: string, _properties?: string[]): Promise<T> {
    const object = this.store.get(id)
    if (!object) {
      throw new HubSpotError(
        `${this.objectType} not found: ${id}`,
        'OBJECT_NOT_FOUND',
        404
      )
    }
    return object
  }

  async update(id: string, input: UpdateInput<T>): Promise<T> {
    const object = this.store.update(id, input.properties as Record<string, string>)
    if (!object) {
      throw new HubSpotError(
        `${this.objectType} not found: ${id}`,
        'OBJECT_NOT_FOUND',
        404
      )
    }
    return object
  }

  async archive(id: string): Promise<void> {
    const success = this.store.archive(id)
    if (!success) {
      throw new HubSpotError(
        `${this.objectType} not found: ${id}`,
        'OBJECT_NOT_FOUND',
        404
      )
    }
  }

  async getPage(options?: {
    limit?: number
    after?: string
    properties?: string[]
  }): Promise<ListResult<T>> {
    const items = this.store.list()
    const limit = options?.limit ?? 100
    const startIndex = options?.after ? items.findIndex(i => i.id === options.after) + 1 : 0
    const results = items.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < items.length

    return {
      results,
      paging: hasMore ? { next: { after: results[results.length - 1]?.id ?? '' } } : undefined,
    }
  }
}

class LocalSearchApi<T extends CRMObject> {
  constructor(private store: InMemoryStore<T>) {}

  async doSearch(request: SearchRequest): Promise<SearchResult<T>> {
    const results = this.store.search(request.filterGroups)

    // Apply sorting
    if (request.sorts && request.sorts.length > 0) {
      const sort = request.sorts[0]
      results.sort((a, b) => {
        const aVal = a.properties[sort.propertyName] ?? ''
        const bVal = b.properties[sort.propertyName] ?? ''
        const cmp = aVal.localeCompare(bVal)
        return sort.direction === 'DESCENDING' ? -cmp : cmp
      })
    }

    // Apply pagination
    const limit = request.limit ?? 100
    const startIndex = request.after
      ? results.findIndex(r => r.id === request.after) + 1
      : 0
    const paged = results.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < results.length

    return {
      total: results.length,
      results: paged,
      paging: hasMore ? { next: { after: paged[paged.length - 1]?.id ?? '' } } : null,
    }
  }
}

class LocalBatchApi<T extends CRMObject> {
  constructor(
    private store: InMemoryStore<T>,
    private objectType: string
  ) {}

  async create(input: BatchCreateInput<T>): Promise<BatchResult<T>> {
    const results: T[] = []
    for (const item of input.inputs) {
      results.push(this.store.create(item.properties as Record<string, string>))
    }
    return { status: 'COMPLETE', results, errors: [] }
  }

  async read(input: BatchReadInput): Promise<BatchResult<T>> {
    const results: T[] = []
    const errors: BatchResult<T>['errors'] = []
    for (const item of input.inputs) {
      const object = this.store.get(item.id)
      if (object) {
        results.push(object)
      } else {
        errors.push({ status: '404', message: `${this.objectType} not found: ${item.id}` })
      }
    }
    return { status: 'COMPLETE', results, errors }
  }

  async update(input: BatchUpdateInput<T>): Promise<BatchResult<T>> {
    const results: T[] = []
    const errors: BatchResult<T>['errors'] = []
    for (const item of input.inputs) {
      const object = this.store.update(item.id, item.properties as Record<string, string>)
      if (object) {
        results.push(object)
      } else {
        errors.push({ status: '404', message: `${this.objectType} not found: ${item.id}` })
      }
    }
    return { status: 'COMPLETE', results, errors }
  }

  async archive(input: BatchArchiveInput): Promise<void> {
    for (const item of input.inputs) {
      this.store.archive(item.id)
    }
  }
}

class LocalCRMObjectApi<T extends CRMObject> {
  basicApi: LocalBasicApi<T>
  searchApi: LocalSearchApi<T>
  batchApi: LocalBatchApi<T>
  private store: InMemoryStore<T>

  constructor(objectType: string) {
    this.store = new InMemoryStore<T>(objectType)
    this.basicApi = new LocalBasicApi<T>(this.store, objectType)
    this.searchApi = new LocalSearchApi<T>(this.store)
    this.batchApi = new LocalBatchApi<T>(this.store, objectType)
  }

  clear(): void {
    this.store.clear()
  }
}

// =============================================================================
// Associations Store
// =============================================================================

class AssociationsStore {
  private associations: Map<string, Association[]> = new Map()

  private getKey(fromType: string, fromId: string, toType: string): string {
    return `${fromType}:${fromId}:${toType}`
  }

  create(
    fromType: string,
    fromId: string,
    toType: string,
    toId: string,
    types: AssociationType[]
  ): Association {
    const key = this.getKey(fromType, fromId, toType)
    const existing = this.associations.get(key) ?? []

    const association: Association = {
      fromObjectTypeId: fromType,
      fromObjectId: Number(fromId),
      toObjectTypeId: toType,
      toObjectId: Number(toId),
      labels: [],
    }

    existing.push(association)
    this.associations.set(key, existing)

    return association
  }

  get(fromType: string, fromId: string, toType: string): AssociationResult[] {
    const key = this.getKey(fromType, fromId, toType)
    const associations = this.associations.get(key) ?? []

    return associations.map(a => ({
      toObjectId: a.toObjectId,
      associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 1 }],
    }))
  }

  clear(): void {
    this.associations.clear()
  }
}

// =============================================================================
// Local Associations API
// =============================================================================

class LocalAssociationsV4BasicApi {
  constructor(private store: AssociationsStore) {}

  async create(
    fromObjectType: string,
    fromObjectId: string,
    toObjectType: string,
    toObjectId: string,
    associationTypes: AssociationType[]
  ): Promise<Association> {
    return this.store.create(fromObjectType, fromObjectId, toObjectType, toObjectId, associationTypes)
  }

  async getPage(
    fromObjectType: string,
    fromObjectId: string,
    toObjectType: string,
    _options?: { limit?: number; after?: string }
  ): Promise<ListResult<AssociationResult>> {
    const results = this.store.get(fromObjectType, fromObjectId, toObjectType)
    return { results }
  }

  async archive(
    _fromObjectType: string,
    _fromObjectId: string,
    _toObjectType: string,
    _toObjectId: string
  ): Promise<void> {
    // No-op for now
  }
}

class LocalAssociationsV4BatchApi {
  constructor(private store: AssociationsStore) {}

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
    const results: Array<{ from: { id: string }; to: { id: string }; type: string }> = []
    for (const item of input.inputs) {
      this.store.create(fromObjectType, item.from.id, toObjectType, item.to.id, item.types)
      results.push({ from: item.from, to: item.to, type: `${fromObjectType}_to_${toObjectType}` })
    }
    return { status: 'COMPLETE', results, errors: [] }
  }
}

class LocalAssociationsV4Api {
  basicApi: LocalAssociationsV4BasicApi
  batchApi: LocalAssociationsV4BatchApi

  constructor(store: AssociationsStore) {
    this.basicApi = new LocalAssociationsV4BasicApi(store)
    this.batchApi = new LocalAssociationsV4BatchApi(store)
  }
}

class LocalAssociationsApi {
  v4: LocalAssociationsV4Api

  constructor(store: AssociationsStore) {
    this.v4 = new LocalAssociationsV4Api(store)
  }
}

// =============================================================================
// Local Pipelines API
// =============================================================================

const DEFAULT_PIPELINES: Record<string, Pipeline[]> = {
  deals: [
    {
      id: 'default',
      label: 'Sales Pipeline',
      displayOrder: 0,
      stages: [
        { id: 'appointmentscheduled', label: 'Appointment Scheduled', displayOrder: 0 },
        { id: 'qualifiedtobuy', label: 'Qualified to Buy', displayOrder: 1 },
        { id: 'presentationscheduled', label: 'Presentation Scheduled', displayOrder: 2 },
        { id: 'decisionmakerboughtin', label: 'Decision Maker Bought-In', displayOrder: 3 },
        { id: 'contractsent', label: 'Contract Sent', displayOrder: 4 },
        { id: 'closedwon', label: 'Closed Won', displayOrder: 5 },
        { id: 'closedlost', label: 'Closed Lost', displayOrder: 6 },
      ],
    },
  ],
  tickets: [
    {
      id: 'default',
      label: 'Support Pipeline',
      displayOrder: 0,
      stages: [
        { id: 'new', label: 'New', displayOrder: 0 },
        { id: 'waiting', label: 'Waiting on Contact', displayOrder: 1 },
        { id: 'waiting_us', label: 'Waiting on Us', displayOrder: 2 },
        { id: 'closed', label: 'Closed', displayOrder: 3 },
      ],
    },
  ],
}

class LocalPipelinesCoreApi {
  async getAll(objectType: string): Promise<ListResult<Pipeline>> {
    const pipelines = DEFAULT_PIPELINES[objectType] ?? []
    return { results: pipelines }
  }

  async getById(objectType: string, pipelineId: string): Promise<Pipeline> {
    const pipelines = DEFAULT_PIPELINES[objectType] ?? []
    const pipeline = pipelines.find(p => p.id === pipelineId)
    if (!pipeline) {
      throw new HubSpotError(`Pipeline not found: ${pipelineId}`, 'OBJECT_NOT_FOUND', 404)
    }
    return pipeline
  }
}

class LocalPipelineStagesApi {
  async getAll(objectType: string, pipelineId: string): Promise<ListResult<Pipeline['stages'][0]>> {
    const pipelines = DEFAULT_PIPELINES[objectType] ?? []
    const pipeline = pipelines.find(p => p.id === pipelineId)
    if (!pipeline) {
      throw new HubSpotError(`Pipeline not found: ${pipelineId}`, 'OBJECT_NOT_FOUND', 404)
    }
    return { results: pipeline.stages }
  }
}

class LocalPipelinesApi {
  pipelinesApi: LocalPipelinesCoreApi
  pipelineStagesApi: LocalPipelineStagesApi

  constructor() {
    this.pipelinesApi = new LocalPipelinesCoreApi()
    this.pipelineStagesApi = new LocalPipelineStagesApi()
  }
}

// =============================================================================
// Local Properties API
// =============================================================================

const DEFAULT_PROPERTIES: Record<string, Property[]> = {
  contacts: [
    { name: 'email', label: 'Email', type: 'string', fieldType: 'text', groupName: 'contactinformation', hasUniqueValue: true, hubspotDefined: true },
    { name: 'firstname', label: 'First Name', type: 'string', fieldType: 'text', groupName: 'contactinformation', hubspotDefined: true },
    { name: 'lastname', label: 'Last Name', type: 'string', fieldType: 'text', groupName: 'contactinformation', hubspotDefined: true },
    { name: 'phone', label: 'Phone', type: 'string', fieldType: 'phonenumber', groupName: 'contactinformation', hubspotDefined: true },
    { name: 'company', label: 'Company', type: 'string', fieldType: 'text', groupName: 'contactinformation', hubspotDefined: true },
    { name: 'lifecyclestage', label: 'Lifecycle Stage', type: 'enumeration', fieldType: 'select', groupName: 'contactinformation', hubspotDefined: true },
  ],
  companies: [
    { name: 'name', label: 'Name', type: 'string', fieldType: 'text', groupName: 'companyinformation', hubspotDefined: true },
    { name: 'domain', label: 'Domain', type: 'string', fieldType: 'text', groupName: 'companyinformation', hasUniqueValue: true, hubspotDefined: true },
    { name: 'industry', label: 'Industry', type: 'enumeration', fieldType: 'select', groupName: 'companyinformation', hubspotDefined: true },
    { name: 'phone', label: 'Phone', type: 'string', fieldType: 'phonenumber', groupName: 'companyinformation', hubspotDefined: true },
    { name: 'numberofemployees', label: 'Number of Employees', type: 'number', fieldType: 'number', groupName: 'companyinformation', hubspotDefined: true },
  ],
  deals: [
    { name: 'dealname', label: 'Deal Name', type: 'string', fieldType: 'text', groupName: 'dealinformation', hubspotDefined: true },
    { name: 'amount', label: 'Amount', type: 'number', fieldType: 'number', groupName: 'dealinformation', hubspotDefined: true },
    { name: 'dealstage', label: 'Deal Stage', type: 'enumeration', fieldType: 'select', groupName: 'dealinformation', hubspotDefined: true },
    { name: 'pipeline', label: 'Pipeline', type: 'enumeration', fieldType: 'select', groupName: 'dealinformation', hubspotDefined: true },
    { name: 'closedate', label: 'Close Date', type: 'datetime', fieldType: 'date', groupName: 'dealinformation', hubspotDefined: true },
  ],
  tickets: [
    { name: 'subject', label: 'Subject', type: 'string', fieldType: 'text', groupName: 'ticketinformation', hubspotDefined: true },
    { name: 'content', label: 'Content', type: 'string', fieldType: 'textarea', groupName: 'ticketinformation', hubspotDefined: true },
    { name: 'hs_pipeline', label: 'Pipeline', type: 'enumeration', fieldType: 'select', groupName: 'ticketinformation', hubspotDefined: true },
    { name: 'hs_pipeline_stage', label: 'Pipeline Stage', type: 'enumeration', fieldType: 'select', groupName: 'ticketinformation', hubspotDefined: true },
    { name: 'hs_ticket_priority', label: 'Priority', type: 'enumeration', fieldType: 'select', groupName: 'ticketinformation', hubspotDefined: true },
  ],
}

const DEFAULT_PROPERTY_GROUPS: Record<string, PropertyGroup[]> = {
  contacts: [
    { name: 'contactinformation', label: 'Contact Information', displayOrder: 0 },
  ],
  companies: [
    { name: 'companyinformation', label: 'Company Information', displayOrder: 0 },
  ],
  deals: [
    { name: 'dealinformation', label: 'Deal Information', displayOrder: 0 },
  ],
  tickets: [
    { name: 'ticketinformation', label: 'Ticket Information', displayOrder: 0 },
  ],
}

class LocalPropertiesCoreApi {
  async getAll(objectType: string): Promise<ListResult<Property>> {
    const properties = DEFAULT_PROPERTIES[objectType] ?? []
    return { results: properties }
  }

  async getByName(objectType: string, propertyName: string): Promise<Property> {
    const properties = DEFAULT_PROPERTIES[objectType] ?? []
    const property = properties.find(p => p.name === propertyName)
    if (!property) {
      throw new HubSpotError(`Property not found: ${propertyName}`, 'OBJECT_NOT_FOUND', 404)
    }
    return property
  }

  async create(_objectType: string, input: Partial<Property>): Promise<Property> {
    return {
      name: input.name ?? 'custom_property',
      label: input.label ?? 'Custom Property',
      type: input.type ?? 'string',
      fieldType: input.fieldType ?? 'text',
      groupName: input.groupName ?? 'custom',
      ...input,
      createdAt: now(),
      updatedAt: now(),
    }
  }

  async update(_objectType: string, _propertyName: string, input: Partial<Property>): Promise<Property> {
    return {
      name: input.name ?? 'custom_property',
      label: input.label ?? 'Custom Property',
      type: input.type ?? 'string',
      fieldType: input.fieldType ?? 'text',
      groupName: input.groupName ?? 'custom',
      ...input,
      updatedAt: now(),
    }
  }

  async archive(_objectType: string, _propertyName: string): Promise<void> {
    // No-op for local
  }
}

class LocalPropertyGroupsApi {
  async getAll(objectType: string): Promise<ListResult<PropertyGroup>> {
    const groups = DEFAULT_PROPERTY_GROUPS[objectType] ?? []
    return { results: groups }
  }
}

class LocalPropertiesApi {
  coreApi: LocalPropertiesCoreApi
  groupsApi: LocalPropertyGroupsApi

  constructor() {
    this.coreApi = new LocalPropertiesCoreApi()
    this.groupsApi = new LocalPropertyGroupsApi()
  }
}

// =============================================================================
// Local Owners API
// =============================================================================

class LocalOwnersApi {
  private owners: Owner[] = [
    {
      id: 'owner-1',
      email: 'owner@example.com',
      firstName: 'Default',
      lastName: 'Owner',
      userId: 1,
      createdAt: now(),
      updatedAt: now(),
      archived: false,
    },
  ]

  async getPage(_options?: { limit?: number; after?: string }): Promise<ListResult<Owner>> {
    return { results: this.owners }
  }

  async getById(ownerId: string): Promise<Owner> {
    const owner = this.owners.find(o => o.id === ownerId)
    if (!owner) {
      throw new HubSpotError(`Owner not found: ${ownerId}`, 'OBJECT_NOT_FOUND', 404)
    }
    return owner
  }
}

// =============================================================================
// Local CRM Objects API
// =============================================================================

class LocalCRMObjectsApi {
  notes: LocalCRMObjectApi<Engagement>
  emails: LocalCRMObjectApi<Engagement>
  calls: LocalCRMObjectApi<Engagement>
  meetings: LocalCRMObjectApi<Engagement>

  constructor() {
    this.notes = new LocalCRMObjectApi<Engagement>('notes')
    this.emails = new LocalCRMObjectApi<Engagement>('emails')
    this.calls = new LocalCRMObjectApi<Engagement>('calls')
    this.meetings = new LocalCRMObjectApi<Engagement>('meetings')
  }

  clear(): void {
    this.notes.clear()
    this.emails.clear()
    this.calls.clear()
    this.meetings.clear()
  }
}

// =============================================================================
// Local CRM API
// =============================================================================

class LocalCRMApi {
  contacts: LocalCRMObjectApi<Contact>
  companies: LocalCRMObjectApi<Company>
  deals: LocalCRMObjectApi<Deal>
  tickets: LocalCRMObjectApi<Ticket>
  lineItems: LocalCRMObjectApi<LineItem>
  products: LocalCRMObjectApi<Product>
  quotes: LocalCRMObjectApi<Quote>
  associations: LocalAssociationsApi
  pipelines: LocalPipelinesApi
  properties: LocalPropertiesApi
  owners: LocalOwnersApi
  objects: LocalCRMObjectsApi

  private associationsStore: AssociationsStore

  constructor() {
    this.contacts = new LocalCRMObjectApi<Contact>('contacts')
    this.companies = new LocalCRMObjectApi<Company>('companies')
    this.deals = new LocalCRMObjectApi<Deal>('deals')
    this.tickets = new LocalCRMObjectApi<Ticket>('tickets')
    this.lineItems = new LocalCRMObjectApi<LineItem>('line_items')
    this.products = new LocalCRMObjectApi<Product>('products')
    this.quotes = new LocalCRMObjectApi<Quote>('quotes')

    this.associationsStore = new AssociationsStore()
    this.associations = new LocalAssociationsApi(this.associationsStore)

    this.pipelines = new LocalPipelinesApi()
    this.properties = new LocalPropertiesApi()
    this.owners = new LocalOwnersApi()
    this.objects = new LocalCRMObjectsApi()
  }

  clear(): void {
    this.contacts.clear()
    this.companies.clear()
    this.deals.clear()
    this.tickets.clear()
    this.lineItems.clear()
    this.products.clear()
    this.quotes.clear()
    this.associationsStore.clear()
    this.objects.clear()
  }
}

// =============================================================================
// Main Local Client
// =============================================================================

/**
 * Local HubSpot Mock Backend
 *
 * In-memory HubSpot mock backend for local development and testing.
 * Provides the same interface as the Client but stores data in memory.
 *
 * @example
 * ```typescript
 * import { LocalHubSpot } from '@dotdo/hubspot/local'
 *
 * const hubspot = new LocalHubSpot()
 *
 * // Create a contact (stored in memory)
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
 *
 * // Clear all data
 * hubspot.clear()
 * ```
 */
export class LocalHubSpot {
  crm: LocalCRMApi

  constructor() {
    this.crm = new LocalCRMApi()
  }

  /**
   * Clear all data from the in-memory store
   */
  clear(): void {
    this.crm.clear()
  }
}
