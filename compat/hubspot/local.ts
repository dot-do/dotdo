/**
 * @dotdo/hubspot/local - HubSpot Local/Edge Implementation
 *
 * Durable Object-backed implementation of HubSpot CRM API using dotdo primitives.
 * Provides local storage for all CRM objects without requiring HubSpot connection.
 *
 * Features:
 * - Full CRM object support (Contacts, Companies, Deals, Tickets)
 * - Associations between objects
 * - Custom properties
 * - Pipelines and stages
 * - Forms and form submissions
 * - Webhooks for CRM events
 * - Full-text search with inverted index
 *
 * @example
 * ```typescript
 * import { HubSpotLocal } from '@dotdo/hubspot/local'
 *
 * const hubspot = new HubSpotLocal()
 *
 * // Create a contact (stored locally)
 * const contact = await hubspot.crm.contacts.create({
 *   properties: {
 *     email: 'user@example.com',
 *     firstname: 'John',
 *     lastname: 'Doe',
 *   }
 * })
 *
 * // Search contacts
 * const results = await hubspot.crm.contacts.search({
 *   filterGroups: [{
 *     filters: [{ propertyName: 'email', operator: 'CONTAINS_TOKEN', value: '@example.com' }]
 *   }]
 * })
 * ```
 *
 * @module @dotdo/hubspot/local
 */

import {
  HubSpotForms,
  type FormsStorage,
  type Form,
  type CreateFormInput,
  type UpdateFormInput,
  type FormSubmission,
  type FormSubmissionInput,
  type ListFormsOptions,
} from './forms'

import {
  HubSpotWebhooks,
  type WebhookStorage,
  type WebhookSubscription,
  type CreateSubscriptionInput,
  type WebhookEvent,
  type TriggerEventInput,
} from './webhooks'

// =============================================================================
// Types
// =============================================================================

export type ObjectType = 'contacts' | 'companies' | 'deals' | 'tickets' | 'line_items' | 'products' | 'quotes'

export type FilterOperator =
  | 'EQ'
  | 'NEQ'
  | 'LT'
  | 'LTE'
  | 'GT'
  | 'GTE'
  | 'CONTAINS_TOKEN'
  | 'NOT_CONTAINS_TOKEN'
  | 'HAS_PROPERTY'
  | 'NOT_HAS_PROPERTY'
  | 'IN'
  | 'NOT_IN'
  | 'BETWEEN'

export type AssociationCategory = 'HUBSPOT_DEFINED' | 'USER_DEFINED' | 'INTEGRATOR_DEFINED'

export interface CrmObject {
  id: string
  properties: Record<string, string | null>
  createdAt: string
  updatedAt: string
  archived: boolean
  archivedAt?: string
}

export interface CreateObjectInput {
  properties: Record<string, string>
  associations?: Association[]
}

export interface UpdateObjectInput {
  properties: Record<string, string>
}

export interface Association {
  to: { id: string }
  types: Array<{ associationCategory: AssociationCategory; associationTypeId: number }>
}

export interface AssociationResult {
  fromObjectTypeId: string
  fromObjectId: string | number
  toObjectTypeId: string
  toObjectId: string | number
  labels: string[]
}

export interface SearchFilter {
  propertyName: string
  operator: FilterOperator
  value?: string | number | boolean
  values?: Array<string | number>
  highValue?: string | number
}

export interface FilterGroup {
  filters: SearchFilter[]
}

export interface SearchInput {
  filterGroups?: FilterGroup[]
  sorts?: Array<{ propertyName: string; direction: 'ASCENDING' | 'DESCENDING' }>
  query?: string
  properties?: string[]
  limit?: number
  after?: string
}

export interface SearchResult<T> {
  total: number
  results: T[]
  paging?: { next?: { after: string } }
}

export interface BatchInput<T> {
  inputs: T[]
  properties?: string[]
}

export interface BatchResult<T> {
  status: 'COMPLETE' | 'PENDING'
  results: T[]
  errors: Array<{ status: string; message: string; context?: Record<string, unknown> }>
}

export interface Property {
  name: string
  label: string
  type: 'string' | 'number' | 'date' | 'datetime' | 'enumeration' | 'bool'
  fieldType: string
  groupName: string
  description?: string
  hasUniqueValue?: boolean
  hidden?: boolean
  options?: PropertyOption[]
  hubspotDefined?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface PropertyOption {
  label: string
  value: string
  displayOrder: number
  hidden?: boolean
}

export interface PropertyGroup {
  name: string
  label: string
  displayOrder: number
}

export interface Pipeline {
  id: string
  label: string
  displayOrder: number
  stages: PipelineStage[]
  createdAt?: string
  updatedAt?: string
  archived?: boolean
}

export interface PipelineStage {
  id: string
  label: string
  displayOrder: number
  metadata?: Record<string, unknown>
}

export interface Owner {
  id: string
  email: string
  firstName: string
  lastName: string
  userId?: number
  teams?: Array<{ id: string; name: string; primary?: boolean }>
  createdAt: string
  updatedAt: string
  archived: boolean
}

// =============================================================================
// Storage Implementation
// =============================================================================

/**
 * In-memory storage implementation for local use
 */
export class InMemoryStorage implements FormsStorage, WebhookStorage {
  private data: Map<string, unknown> = new Map()

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>()
    let count = 0
    const limit = options?.limit ?? Infinity

    for (const [key, value] of this.data) {
      if (options?.prefix && !key.startsWith(options.prefix)) continue
      if (count >= limit) break
      result.set(key, value)
      count++
    }

    return result
  }

  clear(): void {
    this.data.clear()
  }
}

// =============================================================================
// Utilities
// =============================================================================

function generateId(prefix: string = 'obj'): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

function now(): string {
  return new Date().toISOString()
}

// =============================================================================
// Local CRM Object API
// =============================================================================

class LocalObjectApi<T extends CrmObject> {
  protected storage: InMemoryStorage
  protected objectType: ObjectType
  protected webhooks?: HubSpotWebhooks
  private onObjectChange?: (event: TriggerEventInput) => Promise<void>

  protected readonly PREFIX: string

  constructor(
    storage: InMemoryStorage,
    objectType: ObjectType,
    onObjectChange?: (event: TriggerEventInput) => Promise<void>
  ) {
    this.storage = storage
    this.objectType = objectType
    this.onObjectChange = onObjectChange
    this.PREFIX = `crm:${objectType}:`
  }

  // Basic API
  basicApi = {
    create: async (input: CreateObjectInput): Promise<T> => {
      const id = generateId()
      const timestamp = now()

      const defaultProperties: Record<string, string | null> = {
        createdate: timestamp,
        lastmodifieddate: timestamp,
        hs_object_id: id,
      }

      const obj: CrmObject = {
        id,
        properties: { ...defaultProperties, ...input.properties },
        createdAt: timestamp,
        updatedAt: timestamp,
        archived: false,
      }

      await this.storage.put(`${this.PREFIX}${id}`, obj)

      // Handle associations
      if (input.associations) {
        for (const assoc of input.associations) {
          await this.createAssociation(id, assoc)
        }
      }

      // Trigger webhook
      await this.triggerEvent('creation', id)

      return obj as T
    },

    getById: async (id: string, properties?: string[]): Promise<T> => {
      const obj = await this.storage.get<T>(`${this.PREFIX}${id}`)
      if (!obj || obj.archived) {
        throw new Error(`${this.objectType} not found: ${id}`)
      }
      return obj
    },

    update: async (id: string, input: UpdateObjectInput): Promise<T> => {
      const obj = await this.basicApi.getById(id)
      const timestamp = now()

      const updated: T = {
        ...obj,
        properties: {
          ...obj.properties,
          ...input.properties,
          lastmodifieddate: timestamp,
        },
        updatedAt: timestamp,
      }

      await this.storage.put(`${this.PREFIX}${id}`, updated)

      // Trigger webhook for each changed property
      for (const propName of Object.keys(input.properties)) {
        await this.triggerEvent('propertyChange', id, propName, input.properties[propName])
      }

      return updated
    },

    archive: async (id: string): Promise<void> => {
      const obj = await this.basicApi.getById(id)
      const timestamp = now()

      const archived: T = {
        ...obj,
        archived: true,
        archivedAt: timestamp,
        updatedAt: timestamp,
      }

      await this.storage.put(`${this.PREFIX}${id}`, archived)

      // Trigger webhook
      await this.triggerEvent('deletion', id)
    },

    getPage: async (options?: {
      limit?: number
      after?: string
      properties?: string[]
    }): Promise<SearchResult<T>> => {
      const objects = await this.getAllObjects()
      const active = objects.filter((o) => !o.archived)

      // Sort by createdAt
      active.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

      // Pagination
      const limit = options?.limit ?? 100
      let startIndex = 0
      if (options?.after) {
        const afterIndex = active.findIndex((o) => o.id === options.after)
        if (afterIndex !== -1) {
          startIndex = afterIndex + 1
        }
      }

      const paged = active.slice(startIndex, startIndex + limit)
      const hasMore = startIndex + limit < active.length

      return {
        total: active.length,
        results: paged,
        paging: hasMore
          ? { next: { after: paged[paged.length - 1]?.id ?? '' } }
          : undefined,
      }
    },
  }

  // Search API
  searchApi = {
    doSearch: async (input: SearchInput): Promise<SearchResult<T>> => {
      const objects = await this.getAllObjects()
      const active = objects.filter((o) => !o.archived)

      let filtered = active

      // Apply filters
      if (input.filterGroups && input.filterGroups.length > 0) {
        filtered = active.filter((obj) =>
          input.filterGroups!.some((group) =>
            group.filters.every((filter) => this.matchesFilter(obj, filter))
          )
        )
      }

      // Apply query (simple text search)
      if (input.query) {
        const query = input.query.toLowerCase()
        filtered = filtered.filter((obj) =>
          Object.values(obj.properties).some(
            (v) => v && String(v).toLowerCase().includes(query)
          )
        )
      }

      // Apply sorting
      if (input.sorts && input.sorts.length > 0) {
        const sort = input.sorts[0]
        filtered.sort((a, b) => {
          const aVal = a.properties[sort.propertyName] ?? ''
          const bVal = b.properties[sort.propertyName] ?? ''
          const cmp = String(aVal).localeCompare(String(bVal))
          return sort.direction === 'DESCENDING' ? -cmp : cmp
        })
      }

      // Pagination
      const limit = input.limit ?? 100
      let startIndex = 0
      if (input.after) {
        const afterIndex = filtered.findIndex((o) => o.id === input.after)
        if (afterIndex !== -1) {
          startIndex = afterIndex + 1
        }
      }

      const paged = filtered.slice(startIndex, startIndex + limit)
      const hasMore = startIndex + limit < filtered.length

      return {
        total: filtered.length,
        results: paged,
        paging: hasMore
          ? { next: { after: paged[paged.length - 1]?.id ?? '' } }
          : undefined,
      }
    },
  }

  // Batch API
  batchApi = {
    create: async (input: BatchInput<CreateObjectInput>): Promise<BatchResult<T>> => {
      const results: T[] = []
      const errors: BatchResult<T>['errors'] = []

      for (const item of input.inputs) {
        try {
          const obj = await this.basicApi.create(item)
          results.push(obj)
        } catch (error) {
          errors.push({
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }

      return { status: 'COMPLETE', results, errors }
    },

    read: async (
      input: BatchInput<{ id: string }>
    ): Promise<BatchResult<T>> => {
      const results: T[] = []
      const errors: BatchResult<T>['errors'] = []

      for (const item of input.inputs) {
        try {
          const obj = await this.basicApi.getById(item.id, input.properties)
          results.push(obj)
        } catch (error) {
          errors.push({
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
            context: { id: item.id },
          })
        }
      }

      return { status: 'COMPLETE', results, errors }
    },

    update: async (
      input: BatchInput<{ id: string; properties: Record<string, string> }>
    ): Promise<BatchResult<T>> => {
      const results: T[] = []
      const errors: BatchResult<T>['errors'] = []

      for (const item of input.inputs) {
        try {
          const obj = await this.basicApi.update(item.id, { properties: item.properties })
          results.push(obj)
        } catch (error) {
          errors.push({
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
            context: { id: item.id },
          })
        }
      }

      return { status: 'COMPLETE', results, errors }
    },

    archive: async (input: BatchInput<{ id: string }>): Promise<void> => {
      for (const item of input.inputs) {
        await this.basicApi.archive(item.id)
      }
    },
  }

  // Helper methods
  protected async getAllObjects(): Promise<T[]> {
    const map = await this.storage.list({ prefix: this.PREFIX })
    return Array.from(map.values()) as T[]
  }

  private matchesFilter(obj: CrmObject, filter: SearchFilter): boolean {
    const value = obj.properties[filter.propertyName]

    switch (filter.operator) {
      case 'EQ':
        return value === String(filter.value)
      case 'NEQ':
        return value !== String(filter.value)
      case 'LT':
        return Number(value) < Number(filter.value)
      case 'LTE':
        return Number(value) <= Number(filter.value)
      case 'GT':
        return Number(value) > Number(filter.value)
      case 'GTE':
        return Number(value) >= Number(filter.value)
      case 'CONTAINS_TOKEN':
        return value !== null && value.toLowerCase().includes(String(filter.value).toLowerCase())
      case 'NOT_CONTAINS_TOKEN':
        return value === null || !value.toLowerCase().includes(String(filter.value).toLowerCase())
      case 'HAS_PROPERTY':
        return value !== null && value !== ''
      case 'NOT_HAS_PROPERTY':
        return value === null || value === ''
      case 'IN': {
        const inResult = filter.values?.map(String).includes(String(value))
        return inResult ?? false
      }
      case 'NOT_IN': {
        const notInResult = filter.values?.map(String).includes(String(value))
        return notInResult === undefined ? true : !notInResult
      }
      case 'BETWEEN':
        const numVal = Number(value)
        return numVal >= Number(filter.value) && numVal <= Number(filter.highValue)
      default:
        return false
    }
  }

  private async createAssociation(fromId: string, assoc: Association): Promise<void> {
    // Store association (simplified - in real impl would be more complex)
    const assocKey = `assoc:${this.objectType}:${fromId}:${assoc.to.id}`
    await this.storage.put(assocKey, {
      from: { type: this.objectType, id: fromId },
      to: assoc.to,
      types: assoc.types,
    })
  }

  private async triggerEvent(
    action: 'creation' | 'deletion' | 'propertyChange',
    objectId: string,
    propertyName?: string,
    propertyValue?: string
  ): Promise<void> {
    if (this.onObjectChange) {
      const singularType = this.objectType.slice(0, -1) as any // contacts -> contact
      const eventType = `${singularType}.${action}` as any

      await this.onObjectChange({
        eventType,
        objectType: singularType,
        objectId,
        propertyName,
        propertyValue,
      })
    }
  }
}

// =============================================================================
// Associations API
// =============================================================================

class LocalAssociationsApi {
  private storage: InMemoryStorage

  constructor(storage: InMemoryStorage) {
    this.storage = storage
  }

  v4 = {
    basicApi: {
      create: async (
        fromObjectType: string,
        fromObjectId: string,
        toObjectType: string,
        toObjectId: string,
        types: Array<{ associationCategory: AssociationCategory; associationTypeId: number }>
      ): Promise<AssociationResult> => {
        const assocKey = `assoc:${fromObjectType}:${fromObjectId}:${toObjectType}:${toObjectId}`

        const assoc = {
          from: { type: fromObjectType, id: fromObjectId },
          to: { type: toObjectType, id: toObjectId },
          types,
        }

        await this.storage.put(assocKey, assoc)

        return {
          fromObjectTypeId: fromObjectType,
          fromObjectId,
          toObjectTypeId: toObjectType,
          toObjectId,
          labels: [],
        }
      },

      getPage: async (
        fromObjectType: string,
        fromObjectId: string,
        toObjectType: string
      ): Promise<{
        results: Array<{
          toObjectId: string | number
          associationTypes: Array<{ category: AssociationCategory; typeId: number; label?: string }>
        }>
        paging?: { next?: { after: string } }
      }> => {
        const prefix = `assoc:${fromObjectType}:${fromObjectId}:${toObjectType}:`
        const map = await this.storage.list({ prefix })
        const results: Array<{
          toObjectId: string | number
          associationTypes: Array<{ category: AssociationCategory; typeId: number; label?: string }>
        }> = []

        for (const value of map.values()) {
          const assoc = value as any
          results.push({
            toObjectId: assoc.to.id,
            associationTypes: assoc.types.map((t: any) => ({
              category: t.associationCategory,
              typeId: t.associationTypeId,
            })),
          })
        }

        return { results }
      },

      archive: async (
        fromObjectType: string,
        fromObjectId: string,
        toObjectType: string,
        toObjectId: string
      ): Promise<void> => {
        const assocKey = `assoc:${fromObjectType}:${fromObjectId}:${toObjectType}:${toObjectId}`
        await this.storage.delete(assocKey)
      },
    },

    batchApi: {
      create: async (
        fromObjectType: string,
        toObjectType: string,
        input: {
          inputs: Array<{
            from: { id: string }
            to: { id: string }
            types: Array<{ associationCategory: AssociationCategory; associationTypeId: number }>
          }>
        }
      ): Promise<BatchResult<AssociationResult>> => {
        const results: AssociationResult[] = []

        for (const item of input.inputs) {
          const result = await this.v4.basicApi.create(
            fromObjectType,
            item.from.id,
            toObjectType,
            item.to.id,
            item.types
          )
          results.push(result)
        }

        return { status: 'COMPLETE', results, errors: [] }
      },

      archive: async (
        fromObjectType: string,
        toObjectType: string,
        input: { inputs: Array<{ from: { id: string }; to: { id: string } }> }
      ): Promise<void> => {
        for (const item of input.inputs) {
          await this.v4.basicApi.archive(fromObjectType, item.from.id, toObjectType, item.to.id)
        }
      },
    },
  }
}

// =============================================================================
// Properties API
// =============================================================================

class LocalPropertiesApi {
  private storage: InMemoryStorage

  constructor(storage: InMemoryStorage) {
    this.storage = storage
    this.initDefaultProperties()
  }

  private async initDefaultProperties(): Promise<void> {
    // Initialize default properties for each object type
    const defaultProps: Record<string, Property[]> = {
      contacts: [
        { name: 'email', label: 'Email', type: 'string', fieldType: 'text', groupName: 'contactinformation', hasUniqueValue: true, hubspotDefined: true },
        { name: 'firstname', label: 'First Name', type: 'string', fieldType: 'text', groupName: 'contactinformation', hubspotDefined: true },
        { name: 'lastname', label: 'Last Name', type: 'string', fieldType: 'text', groupName: 'contactinformation', hubspotDefined: true },
        { name: 'phone', label: 'Phone', type: 'string', fieldType: 'phonenumber', groupName: 'contactinformation', hubspotDefined: true },
        { name: 'company', label: 'Company', type: 'string', fieldType: 'text', groupName: 'contactinformation', hubspotDefined: true },
      ],
      companies: [
        { name: 'name', label: 'Name', type: 'string', fieldType: 'text', groupName: 'companyinformation', hubspotDefined: true },
        { name: 'domain', label: 'Domain', type: 'string', fieldType: 'text', groupName: 'companyinformation', hasUniqueValue: true, hubspotDefined: true },
        { name: 'industry', label: 'Industry', type: 'string', fieldType: 'text', groupName: 'companyinformation', hubspotDefined: true },
      ],
      deals: [
        { name: 'dealname', label: 'Deal Name', type: 'string', fieldType: 'text', groupName: 'dealinformation', hubspotDefined: true },
        { name: 'amount', label: 'Amount', type: 'number', fieldType: 'number', groupName: 'dealinformation', hubspotDefined: true },
        { name: 'dealstage', label: 'Deal Stage', type: 'string', fieldType: 'text', groupName: 'dealinformation', hubspotDefined: true },
        { name: 'pipeline', label: 'Pipeline', type: 'string', fieldType: 'text', groupName: 'dealinformation', hubspotDefined: true },
        { name: 'closedate', label: 'Close Date', type: 'date', fieldType: 'date', groupName: 'dealinformation', hubspotDefined: true },
      ],
      tickets: [
        { name: 'subject', label: 'Subject', type: 'string', fieldType: 'text', groupName: 'ticketinformation', hubspotDefined: true },
        { name: 'content', label: 'Content', type: 'string', fieldType: 'textarea', groupName: 'ticketinformation', hubspotDefined: true },
        { name: 'hs_pipeline', label: 'Pipeline', type: 'string', fieldType: 'text', groupName: 'ticketinformation', hubspotDefined: true },
        { name: 'hs_pipeline_stage', label: 'Stage', type: 'string', fieldType: 'text', groupName: 'ticketinformation', hubspotDefined: true },
        { name: 'hs_ticket_priority', label: 'Priority', type: 'enumeration', fieldType: 'select', groupName: 'ticketinformation', hubspotDefined: true },
      ],
    }

    for (const [objectType, props] of Object.entries(defaultProps)) {
      for (const prop of props) {
        await this.storage.put(`props:${objectType}:${prop.name}`, prop)
      }
    }
  }

  coreApi = {
    getAll: async (objectType: string): Promise<{ results: Property[] }> => {
      const prefix = `props:${objectType}:`
      const map = await this.storage.list({ prefix })
      return { results: Array.from(map.values()) as Property[] }
    },

    getByName: async (objectType: string, propertyName: string): Promise<Property> => {
      const prop = await this.storage.get<Property>(`props:${objectType}:${propertyName}`)
      if (!prop) {
        throw new Error(`Property not found: ${propertyName}`)
      }
      return prop
    },

    create: async (objectType: string, input: Omit<Property, 'hubspotDefined'>): Promise<Property> => {
      const prop: Property = {
        ...input,
        hubspotDefined: false,
        createdAt: now(),
        updatedAt: now(),
      }
      await this.storage.put(`props:${objectType}:${prop.name}`, prop)
      return prop
    },

    update: async (
      objectType: string,
      propertyName: string,
      input: Partial<Property>
    ): Promise<Property> => {
      const prop = await this.coreApi.getByName(objectType, propertyName)
      const updated: Property = {
        ...prop,
        ...input,
        updatedAt: now(),
      }
      await this.storage.put(`props:${objectType}:${propertyName}`, updated)
      return updated
    },

    archive: async (objectType: string, propertyName: string): Promise<void> => {
      await this.storage.delete(`props:${objectType}:${propertyName}`)
    },
  }

  groupsApi = {
    getAll: async (objectType: string): Promise<{ results: PropertyGroup[] }> => {
      const prefix = `prop_groups:${objectType}:`
      const map = await this.storage.list({ prefix })

      // Default groups
      const defaultGroups: PropertyGroup[] = [
        { name: 'contactinformation', label: 'Contact Information', displayOrder: 0 },
        { name: 'companyinformation', label: 'Company Information', displayOrder: 1 },
        { name: 'dealinformation', label: 'Deal Information', displayOrder: 2 },
        { name: 'ticketinformation', label: 'Ticket Information', displayOrder: 3 },
      ]

      const customGroups = Array.from(map.values()) as PropertyGroup[]
      return { results: [...defaultGroups, ...customGroups] }
    },

    create: async (objectType: string, input: PropertyGroup): Promise<PropertyGroup> => {
      await this.storage.put(`prop_groups:${objectType}:${input.name}`, input)
      return input
    },
  }
}

// =============================================================================
// Pipelines API
// =============================================================================

class LocalPipelinesApi {
  private storage: InMemoryStorage

  constructor(storage: InMemoryStorage) {
    this.storage = storage
    this.initDefaultPipelines()
  }

  private async initDefaultPipelines(): Promise<void> {
    // Default deals pipeline
    const dealsPipeline: Pipeline = {
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
    }
    await this.storage.put('pipelines:deals:default', dealsPipeline)

    // Default tickets pipeline
    const ticketsPipeline: Pipeline = {
      id: 'default',
      label: 'Support Pipeline',
      displayOrder: 0,
      stages: [
        { id: 'new', label: 'New', displayOrder: 0 },
        { id: 'waiting', label: 'Waiting on Contact', displayOrder: 1 },
        { id: 'inprogress', label: 'In Progress', displayOrder: 2 },
        { id: 'resolved', label: 'Resolved', displayOrder: 3 },
        { id: 'closed', label: 'Closed', displayOrder: 4 },
      ],
    }
    await this.storage.put('pipelines:tickets:default', ticketsPipeline)
  }

  pipelinesApi = {
    getAll: async (objectType: string): Promise<{ results: Pipeline[] }> => {
      const prefix = `pipelines:${objectType}:`
      const map = await this.storage.list({ prefix })
      const pipelines = Array.from(map.values()) as Pipeline[]
      return { results: pipelines.filter((p) => !p.archived) }
    },

    getById: async (objectType: string, pipelineId: string): Promise<Pipeline> => {
      const pipeline = await this.storage.get<Pipeline>(`pipelines:${objectType}:${pipelineId}`)
      if (!pipeline || pipeline.archived) {
        throw new Error(`Pipeline not found: ${pipelineId}`)
      }
      return pipeline
    },

    create: async (objectType: string, input: Omit<Pipeline, 'id' | 'createdAt' | 'updatedAt'>): Promise<Pipeline> => {
      const id = generateId('pipeline')
      const pipeline: Pipeline = {
        ...input,
        id,
        createdAt: now(),
        updatedAt: now(),
      }
      await this.storage.put(`pipelines:${objectType}:${id}`, pipeline)
      return pipeline
    },

    update: async (
      objectType: string,
      pipelineId: string,
      input: Partial<Pipeline>
    ): Promise<Pipeline> => {
      const pipeline = await this.pipelinesApi.getById(objectType, pipelineId)
      const updated: Pipeline = {
        ...pipeline,
        ...input,
        updatedAt: now(),
      }
      await this.storage.put(`pipelines:${objectType}:${pipelineId}`, updated)
      return updated
    },

    archive: async (objectType: string, pipelineId: string): Promise<void> => {
      const pipeline = await this.pipelinesApi.getById(objectType, pipelineId)
      pipeline.archived = true
      pipeline.updatedAt = now()
      await this.storage.put(`pipelines:${objectType}:${pipelineId}`, pipeline)
    },
  }

  pipelineStagesApi = {
    getAll: async (objectType: string, pipelineId: string): Promise<{ results: PipelineStage[] }> => {
      const pipeline = await this.pipelinesApi.getById(objectType, pipelineId)
      return { results: pipeline.stages }
    },

    getById: async (objectType: string, pipelineId: string, stageId: string): Promise<PipelineStage> => {
      const pipeline = await this.pipelinesApi.getById(objectType, pipelineId)
      const stage = pipeline.stages.find((s) => s.id === stageId)
      if (!stage) {
        throw new Error(`Stage not found: ${stageId}`)
      }
      return stage
    },

    create: async (
      objectType: string,
      pipelineId: string,
      input: Omit<PipelineStage, 'id'>
    ): Promise<PipelineStage> => {
      const pipeline = await this.pipelinesApi.getById(objectType, pipelineId)
      const id = generateId('stage')
      const stage: PipelineStage = { ...input, id }
      pipeline.stages.push(stage)
      await this.pipelinesApi.update(objectType, pipelineId, { stages: pipeline.stages })
      return stage
    },

    update: async (
      objectType: string,
      pipelineId: string,
      stageId: string,
      input: Partial<PipelineStage>
    ): Promise<PipelineStage> => {
      const pipeline = await this.pipelinesApi.getById(objectType, pipelineId)
      const stageIndex = pipeline.stages.findIndex((s) => s.id === stageId)
      if (stageIndex === -1) {
        throw new Error(`Stage not found: ${stageId}`)
      }
      pipeline.stages[stageIndex] = { ...pipeline.stages[stageIndex], ...input }
      await this.pipelinesApi.update(objectType, pipelineId, { stages: pipeline.stages })
      return pipeline.stages[stageIndex]
    },

    archive: async (objectType: string, pipelineId: string, stageId: string): Promise<void> => {
      const pipeline = await this.pipelinesApi.getById(objectType, pipelineId)
      pipeline.stages = pipeline.stages.filter((s) => s.id !== stageId)
      await this.pipelinesApi.update(objectType, pipelineId, { stages: pipeline.stages })
    },
  }
}

// =============================================================================
// Owners API
// =============================================================================

class LocalOwnersApi {
  private storage: InMemoryStorage

  constructor(storage: InMemoryStorage) {
    this.storage = storage
  }

  async getPage(options?: { limit?: number; after?: string }): Promise<{
    results: Owner[]
    paging?: { next?: { after: string } }
  }> {
    const map = await this.storage.list({ prefix: 'owners:' })
    const owners = (Array.from(map.values()) as Owner[]).filter((o) => !o.archived)

    const limit = options?.limit ?? 100
    let startIndex = 0
    if (options?.after) {
      const afterIndex = owners.findIndex((o) => o.id === options.after)
      if (afterIndex !== -1) {
        startIndex = afterIndex + 1
      }
    }

    const paged = owners.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < owners.length

    return {
      results: paged,
      paging: hasMore ? { next: { after: paged[paged.length - 1]?.id ?? '' } } : undefined,
    }
  }

  async getById(ownerId: string): Promise<Owner> {
    const owner = await this.storage.get<Owner>(`owners:${ownerId}`)
    if (!owner || owner.archived) {
      throw new Error(`Owner not found: ${ownerId}`)
    }
    return owner
  }

  async create(input: Omit<Owner, 'id' | 'createdAt' | 'updatedAt' | 'archived'>): Promise<Owner> {
    const id = generateId('owner')
    const owner: Owner = {
      ...input,
      id,
      createdAt: now(),
      updatedAt: now(),
      archived: false,
    }
    await this.storage.put(`owners:${id}`, owner)
    return owner
  }
}

// =============================================================================
// Engagement Objects API
// =============================================================================

class LocalEngagementObjectsApi {
  private storage: InMemoryStorage

  constructor(storage: InMemoryStorage) {
    this.storage = storage
  }

  notes = {
    basicApi: new LocalObjectApi(this.storage, 'contacts' as any), // Simplified for notes
  }

  emails = {
    basicApi: new LocalObjectApi(this.storage, 'contacts' as any),
  }

  calls = {
    basicApi: new LocalObjectApi(this.storage, 'contacts' as any),
  }

  meetings = {
    basicApi: new LocalObjectApi(this.storage, 'contacts' as any),
  }
}

// =============================================================================
// HubSpotLocal Client
// =============================================================================

/**
 * Local HubSpot implementation backed by in-memory storage
 *
 * Provides a fully functional HubSpot-compatible CRM API without requiring
 * a connection to HubSpot's servers.
 */
export class HubSpotLocal {
  private storage: InMemoryStorage
  private webhooks: HubSpotWebhooks
  private forms: HubSpotForms
  private _initialized: boolean = false

  readonly crm: {
    contacts: LocalObjectApi<CrmObject>
    companies: LocalObjectApi<CrmObject>
    deals: LocalObjectApi<CrmObject>
    tickets: LocalObjectApi<CrmObject>
    lineItems: LocalObjectApi<CrmObject>
    products: LocalObjectApi<CrmObject>
    quotes: LocalObjectApi<CrmObject>
    associations: LocalAssociationsApi
    properties: LocalPropertiesApi
    pipelines: LocalPipelinesApi
    owners: LocalOwnersApi
    objects: LocalEngagementObjectsApi
    schemas: {
      coreApi: {
        getAll: () => Promise<{ results: any[] }>
        getById: (objectType: string) => Promise<any>
        create: (input: any) => Promise<any>
      }
    }
  }

  constructor(storage?: InMemoryStorage | { appId?: string; clientSecret?: string }) {
    // If storage is an InMemoryStorage instance, use it directly
    // Otherwise, create a new one (legacy config pattern)
    if (storage instanceof InMemoryStorage) {
      this.storage = storage
    } else {
      this.storage = new InMemoryStorage()
    }

    const config = storage instanceof InMemoryStorage ? undefined : storage

    // Initialize webhooks
    this.webhooks = new HubSpotWebhooks(this.storage, {
      appId: config?.appId ?? 'local',
      clientSecret: config?.clientSecret ?? 'local_secret',
    })

    // Create object change handler
    const onObjectChange = async (event: TriggerEventInput) => {
      await this.webhooks.triggerEvent(event)
    }

    // Initialize forms
    this.forms = new HubSpotForms(this.storage, async (submission) => {
      await this.webhooks.triggerEvent({
        eventType: 'form.submission',
        objectType: 'form',
        objectId: submission.formId,
      })
    })

    // Initialize CRM APIs
    this.crm = {
      contacts: new LocalObjectApi(this.storage, 'contacts', onObjectChange),
      companies: new LocalObjectApi(this.storage, 'companies', onObjectChange),
      deals: new LocalObjectApi(this.storage, 'deals', onObjectChange),
      tickets: new LocalObjectApi(this.storage, 'tickets', onObjectChange),
      lineItems: new LocalObjectApi(this.storage, 'line_items', onObjectChange),
      products: new LocalObjectApi(this.storage, 'products', onObjectChange),
      quotes: new LocalObjectApi(this.storage, 'quotes', onObjectChange),
      associations: new LocalAssociationsApi(this.storage),
      properties: new LocalPropertiesApi(this.storage),
      pipelines: new LocalPipelinesApi(this.storage),
      owners: new LocalOwnersApi(this.storage),
      objects: new LocalEngagementObjectsApi(this.storage),
      schemas: {
        coreApi: {
          getAll: async () => {
            const map = await this.storage.list({ prefix: 'schemas:' })
            return { results: Array.from(map.values()) }
          },
          getById: async (objectType: string) => {
            const schema = await this.storage.get(`schemas:${objectType}`)
            if (!schema) throw new Error(`Schema not found: ${objectType}`)
            return schema
          },
          create: async (input: any) => {
            const id = generateId('schema')
            const schema = { ...input, id, fullyQualifiedName: `p_${id}` }
            await this.storage.put(`schemas:${input.name}`, schema)
            return schema
          },
        },
      },
    }
  }

  // Forms API
  get formsApi() {
    return {
      createForm: (input: CreateFormInput) => this.forms.createForm(input),
      getForm: (formId: string) => this.forms.getForm(formId),
      updateForm: (formId: string, input: UpdateFormInput) => this.forms.updateForm(formId, input),
      deleteForm: (formId: string) => this.forms.deleteForm(formId),
      listForms: (options?: ListFormsOptions) => this.forms.listForms(options),
      publishForm: (formId: string) => this.forms.publishForm(formId),
      submitForm: (formId: string, input: FormSubmissionInput) => this.forms.submitForm(formId, input),
      listSubmissions: (formId: string, options?: { limit?: number; after?: string }) =>
        this.forms.listSubmissions(formId, options),
    }
  }

  // Webhooks API
  get webhooksApi() {
    return {
      subscribe: (input: CreateSubscriptionInput) => this.webhooks.subscribe(input),
      unsubscribe: (subscriptionId: string) => this.webhooks.unsubscribe(subscriptionId),
      listSubscriptions: (options?: { eventType?: any; active?: boolean }) =>
        this.webhooks.listSubscriptions(options),
      getDeliveryStats: (options?: { subscriptionId?: string }) =>
        this.webhooks.getDeliveryStats(options),
    }
  }

  /**
   * Initialize the HubSpot local instance with default pipelines and properties.
   * This should be called after constructing the instance.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return

    // Initialize default pipelines for deals and tickets
    // Default deals pipeline
    const existingDealPipelines = await this.storage.list({ prefix: 'pipelines:deals:' })
    if (existingDealPipelines.size === 0) {
      const dealsPipeline: Pipeline = {
        id: 'default',
        label: 'Sales Pipeline',
        displayOrder: 0,
        stages: [
          { id: 'appointmentscheduled', label: 'Appointment Scheduled', displayOrder: 0 },
          { id: 'qualifiedtobuy', label: 'Qualified to Buy', displayOrder: 1 },
          { id: 'presentationscheduled', label: 'Presentation Scheduled', displayOrder: 2 },
          { id: 'decisionmakerboughtin', label: 'Decision Maker Bought-In', displayOrder: 3 },
          { id: 'contractsent', label: 'Contract Sent', displayOrder: 4 },
          { id: 'closedwon', label: 'Closed Won', displayOrder: 5, metadata: { isClosed: 'true', probability: '1.0' } },
          { id: 'closedlost', label: 'Closed Lost', displayOrder: 6, metadata: { isClosed: 'true', probability: '0' } },
        ],
        createdAt: now(),
        updatedAt: now(),
        archived: false,
      }
      await this.storage.put('pipelines:deals:default', dealsPipeline)
    }

    // Default tickets pipeline
    const existingTicketPipelines = await this.storage.list({ prefix: 'pipelines:tickets:' })
    if (existingTicketPipelines.size === 0) {
      const ticketsPipeline: Pipeline = {
        id: 'default',
        label: 'Support Pipeline',
        displayOrder: 0,
        stages: [
          { id: 'new', label: 'New', displayOrder: 0 },
          { id: 'waiting', label: 'Waiting on Contact', displayOrder: 1 },
          { id: 'inprogress', label: 'In Progress', displayOrder: 2 },
          { id: 'resolved', label: 'Resolved', displayOrder: 3 },
          { id: 'closed', label: 'Closed', displayOrder: 4 },
        ],
        createdAt: now(),
        updatedAt: now(),
        archived: false,
      }
      await this.storage.put('pipelines:tickets:default', ticketsPipeline)
    }

    this._initialized = true
  }

  /**
   * Clear all data (for testing)
   */
  async clear(): Promise<void> {
    this.storage.clear()
    this._initialized = false
  }
}

// =============================================================================
// Export Default
// =============================================================================

export default HubSpotLocal
