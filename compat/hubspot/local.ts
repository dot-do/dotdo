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

      // Add default pipeline for deals
      if (this.objectType === 'deals' && !input.properties.pipeline) {
        defaultProperties.pipeline = 'default'
      }

      const obj: CrmObject = {
        id,
        properties: { ...defaultProperties, ...input.properties },
        createdAt: timestamp,
        updatedAt: timestamp,
        archived: false,
      }

      await this.storage.put(`${this.PREFIX}${id}`, obj)

      // Initialize property history
      const historyKey = `${this.PREFIX}${id}:history`
      const initialHistory: Record<string, Array<{ value: string | null; timestamp: string }>> = {}
      for (const [propName, propValue] of Object.entries(obj.properties)) {
        initialHistory[propName] = [{ value: propValue, timestamp }]
      }
      await this.storage.put(historyKey, initialHistory)

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

    getById: async (id: string, options?: string[] | {
      properties?: string[]
      associations?: string[]
      propertiesWithHistory?: string[]
    }): Promise<T & {
      associations?: Record<string, unknown>
      propertiesWithHistory?: Record<string, Array<{ value: string | null; timestamp: string }>>
    }> => {
      const obj = await this.storage.get<T>(`${this.PREFIX}${id}`)
      if (!obj || obj.archived) {
        throw new Error(`${this.objectType} not found: ${id}`)
      }

      // If options is just a string array (legacy), return the object as-is
      if (Array.isArray(options) || !options) {
        return obj
      }

      const result: T & {
        associations?: Record<string, Array<{ toObjectId: string | number }>>
        propertiesWithHistory?: Record<string, Array<{ value: string | null; timestamp: string }>>
      } = { ...obj }

      // Fetch associations if requested
      if (options.associations && options.associations.length > 0) {
        result.associations = {}
        for (const assocType of options.associations) {
          const prefix = `assoc:${this.objectType}:${id}:${assocType}:`
          const map = await this.storage.list({ prefix })
          const assocResults: Array<{ toObjectId: string | number }> = []
          for (const value of map.values()) {
            const assoc = value as any
            assocResults.push({ toObjectId: assoc.to.id })
          }
          if (assocResults.length > 0) {
            result.associations[assocType] = assocResults
          }
        }
      }

      // Fetch property history if requested
      if (options.propertiesWithHistory && options.propertiesWithHistory.length > 0) {
        const historyKey = `${this.PREFIX}${id}:history`
        const history = await this.storage.get<Record<string, Array<{ value: string | null; timestamp: string }>>>(historyKey)
        if (history) {
          result.propertiesWithHistory = {}
          for (const propName of options.propertiesWithHistory) {
            if (history[propName]) {
              result.propertiesWithHistory[propName] = history[propName]
            }
          }
        }
      }

      return result
    },

    update: async (id: string, input: UpdateObjectInput): Promise<T> => {
      const obj = await this.basicApi.getById(id) as T
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

      // Update property history
      const historyKey = `${this.PREFIX}${id}:history`
      const history = await this.storage.get<Record<string, Array<{ value: string | null; timestamp: string }>>>(historyKey) ?? {}
      for (const [propName, propValue] of Object.entries(input.properties)) {
        if (!history[propName]) {
          history[propName] = []
        }
        history[propName].push({ value: propValue, timestamp })
      }
      await this.storage.put(historyKey, history)

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
          // Try numeric comparison first, fall back to string comparison
          const aNum = Number(aVal)
          const bNum = Number(bVal)
          let cmp: number
          if (!isNaN(aNum) && !isNaN(bNum)) {
            cmp = aNum - bNum
          } else {
            cmp = String(aVal).localeCompare(String(bVal))
          }
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

  // Extended basicApi methods for deals
  extendedBasicApi = {
    getStageHistory: async (id: string): Promise<Array<{
      stageId: string
      enteredAt: string
      exitedAt?: string
      durationMs?: number
    }>> => {
      const historyKey = `${this.PREFIX}${id}:stage_history`
      const history = await this.storage.get<Array<{
        stageId: string
        enteredAt: string
        exitedAt?: string
        durationMs?: number
      }>>(historyKey)
      return history ?? []
    },
  }

  // Helper methods
  protected async getAllObjects(): Promise<T[]> {
    const map = await this.storage.list({ prefix: this.PREFIX })
    const objects: T[] = []
    for (const [key, value] of map.entries()) {
      // Filter out history entries and other non-object entries
      if (key.includes(':history')) continue
      const obj = value as any
      // Verify it's a CRM object (has properties)
      if (obj && obj.properties && obj.id) {
        objects.push(obj as T)
      }
    }
    return objects
  }

  protected matchesFilter(obj: CrmObject, filter: SearchFilter): boolean {
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
// Local Deals Object API (extends LocalObjectApi with deal-specific features)
// =============================================================================

class LocalDealsObjectApi extends LocalObjectApi<CrmObject> {
  private pipelinesApi: LocalPipelinesApi

  constructor(
    storage: InMemoryStorage,
    onObjectChange?: (event: TriggerEventInput) => Promise<void>,
    pipelinesApi?: LocalPipelinesApi
  ) {
    super(storage, 'deals', onObjectChange)
    // Will be set after pipelines are initialized
    this.pipelinesApi = pipelinesApi!
  }

  setPipelinesApi(pipelinesApi: LocalPipelinesApi): void {
    this.pipelinesApi = pipelinesApi
  }

  // Override basicApi to add deal-specific methods
  override basicApi = {
    ...super.basicApi,

    create: async (input: CreateObjectInput): Promise<CrmObject> => {
      // Validate stage exists in pipeline
      const pipelineId = input.properties.pipeline || 'default'
      const stageId = input.properties.dealstage

      if (stageId && this.pipelinesApi) {
        try {
          await this.pipelinesApi.pipelineStagesApi.getById('deals', pipelineId, stageId)
        } catch {
          throw new Error(`Invalid stage "${stageId}" for pipeline "${pipelineId}"`)
        }
      }

      // Call parent create
      const id = generateId()
      const timestamp = now()

      const defaultProperties: Record<string, string | null> = {
        createdate: timestamp,
        lastmodifieddate: timestamp,
        hs_object_id: id,
        pipeline: pipelineId,
      }

      // Check for rotation config and assign owner if not already set
      let assignedOwner: string | null = null
      if (!input.properties.hubspot_owner_id && stageId) {
        const rotationKey = `rotation:deals:${pipelineId}`
        const rotationConfig = await this.storage.get<{
          enabled: boolean
          method: 'round_robin' | 'weighted'
          ownerIds?: string[]
          weights?: Record<string, number>
          triggerStage: string
        }>(rotationKey)

        if (rotationConfig?.enabled && rotationConfig.triggerStage === stageId) {
          if (rotationConfig.method === 'round_robin' && rotationConfig.ownerIds && rotationConfig.ownerIds.length > 0) {
            // Get current rotation index
            const rotationIndexKey = `rotation_index:deals:${pipelineId}`
            const currentIndex = await this.storage.get<number>(rotationIndexKey) ?? 0
            assignedOwner = rotationConfig.ownerIds[currentIndex % rotationConfig.ownerIds.length]
            // Update rotation index
            await this.storage.put(rotationIndexKey, (currentIndex + 1) % rotationConfig.ownerIds.length)
          } else if (rotationConfig.method === 'weighted' && rotationConfig.weights) {
            // Weighted random selection
            const ownerIds = Object.keys(rotationConfig.weights)
            const totalWeight = Object.values(rotationConfig.weights).reduce((sum, w) => sum + w, 0)
            let random = Math.random() * totalWeight
            for (const ownerId of ownerIds) {
              random -= rotationConfig.weights[ownerId]
              if (random <= 0) {
                assignedOwner = ownerId
                break
              }
            }
          }
        }
      }

      const obj: CrmObject = {
        id,
        properties: {
          ...defaultProperties,
          ...input.properties,
          ...(assignedOwner ? { hubspot_owner_id: assignedOwner } : {}),
        },
        createdAt: timestamp,
        updatedAt: timestamp,
        archived: false,
      }

      await this.storage.put(`${this.PREFIX}${id}`, obj)

      // Initialize property history
      const historyKey = `${this.PREFIX}${id}:history`
      const initialHistory: Record<string, Array<{ value: string | null; timestamp: string }>> = {}
      for (const [propName, propValue] of Object.entries(obj.properties)) {
        initialHistory[propName] = [{ value: propValue, timestamp }]
      }
      await this.storage.put(historyKey, initialHistory)

      // Initialize stage history
      if (stageId) {
        const stageHistoryKey = `${this.PREFIX}${id}:stage_history`
        await this.storage.put(stageHistoryKey, [{
          stage: stageId,
          enteredAt: timestamp,
          timeInStageMs: 0,
        }])
      }

      return obj
    },

    getById: async (id: string, options?: string[] | {
      properties?: string[]
      associations?: string[]
      propertiesWithHistory?: string[]
    }): Promise<CrmObject & {
      associations?: Record<string, unknown>
      propertiesWithHistory?: Record<string, Array<{ value: string | null; timestamp: string }>>
    }> => {
      const obj = await this.storage.get<CrmObject>(`${this.PREFIX}${id}`)
      if (!obj || obj.archived) {
        throw new Error(`deals not found: ${id}`)
      }

      // If options is just a string array (legacy), return the object as-is
      if (Array.isArray(options) || !options) {
        return obj
      }

      const result: CrmObject & {
        associations?: Record<string, Array<{ toObjectId: string | number }>>
        propertiesWithHistory?: Record<string, Array<{ value: string | null; timestamp: string }>>
      } = { ...obj }

      // Fetch associations if requested
      if (options.associations && options.associations.length > 0) {
        result.associations = {}
        for (const assocType of options.associations) {
          const prefix = `assoc:deals:${id}:${assocType}:`
          const map = await this.storage.list({ prefix })
          const assocResults: Array<{ toObjectId: string | number }> = []
          for (const value of map.values()) {
            const assoc = value as any
            assocResults.push({ toObjectId: assoc.to.id })
          }
          if (assocResults.length > 0) {
            result.associations[assocType] = assocResults
          }
        }
      }

      // Fetch property history if requested
      if (options.propertiesWithHistory && options.propertiesWithHistory.length > 0) {
        const historyKey = `${this.PREFIX}${id}:history`
        const history = await this.storage.get<Record<string, Array<{ value: string | null; timestamp: string }>>>(historyKey)
        if (history) {
          result.propertiesWithHistory = {}
          for (const propName of options.propertiesWithHistory) {
            if (history[propName]) {
              result.propertiesWithHistory[propName] = history[propName]
            }
          }
        }
      }

      return result
    },

    update: async (id: string, input: UpdateObjectInput): Promise<CrmObject> => {
      const obj = await this.basicApi.getById(id) as CrmObject
      const timestamp = now()
      const oldStage = obj.properties.dealstage
      const newStage = input.properties.dealstage
      const pipelineId = input.properties.pipeline || obj.properties.pipeline || 'default'

      // Validate stage exists in pipeline if changing stage
      if (newStage && newStage !== oldStage && this.pipelinesApi) {
        try {
          await this.pipelinesApi.pipelineStagesApi.getById('deals', pipelineId, newStage)
        } catch {
          throw new Error(`Invalid stage "${newStage}" for pipeline "${pipelineId}"`)
        }
      }

      const updated: CrmObject = {
        ...obj,
        properties: {
          ...obj.properties,
          ...input.properties,
          lastmodifieddate: timestamp,
        },
        updatedAt: timestamp,
      }

      await this.storage.put(`${this.PREFIX}${id}`, updated)

      // Update property history
      const historyKey = `${this.PREFIX}${id}:history`
      const history = await this.storage.get<Record<string, Array<{ value: string | null; timestamp: string }>>>(historyKey) ?? {}
      for (const [propName, propValue] of Object.entries(input.properties)) {
        if (!history[propName]) {
          history[propName] = []
        }
        history[propName].push({ value: propValue, timestamp })
      }
      await this.storage.put(historyKey, history)

      // Update stage history if stage changed
      if (newStage && newStage !== oldStage) {
        const stageHistoryKey = `${this.PREFIX}${id}:stage_history`
        const stageHistory = await this.storage.get<Array<{
          stage: string
          enteredAt: string
          exitedAt?: string
          timeInStageMs: number
        }>>(stageHistoryKey) ?? []

        // Close out the previous stage
        if (stageHistory.length > 0) {
          const lastEntry = stageHistory[stageHistory.length - 1]
          if (!lastEntry.exitedAt) {
            lastEntry.exitedAt = timestamp
            const enteredTime = new Date(lastEntry.enteredAt).getTime()
            lastEntry.timeInStageMs = new Date(timestamp).getTime() - enteredTime
          }
        }

        // Add new stage entry
        stageHistory.push({
          stage: newStage,
          enteredAt: timestamp,
          timeInStageMs: 0,
        })

        await this.storage.put(stageHistoryKey, stageHistory)
      }

      return updated
    },

    getPage: async (options?: {
      limit?: number
      after?: string
      properties?: string[]
    }): Promise<SearchResult<CrmObject>> => {
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

    archive: async (id: string): Promise<void> => {
      const obj = await this.basicApi.getById(id)
      const timestamp = now()

      const archived: CrmObject = {
        ...obj,
        archived: true,
        archivedAt: timestamp,
        updatedAt: timestamp,
      }

      await this.storage.put(`${this.PREFIX}${id}`, archived)
    },

    getStageHistory: async (id: string): Promise<Array<{
      stage: string
      enteredAt: string
      exitedAt?: string
      timeInStageMs: number
    }>> => {
      const stageHistoryKey = `${this.PREFIX}${id}:stage_history`
      const history = await this.storage.get<Array<{
        stage: string
        enteredAt: string
        exitedAt?: string
        timeInStageMs: number
      }>>(stageHistoryKey)

      if (!history || history.length === 0) {
        return []
      }

      // Calculate current time in stage for the active stage
      const result = [...history]
      const lastEntry = result[result.length - 1]
      if (!lastEntry.exitedAt) {
        const enteredTime = new Date(lastEntry.enteredAt).getTime()
        lastEntry.timeInStageMs = Date.now() - enteredTime
      }

      return result
    },
  }

  // Extended search API with forecast methods
  override searchApi = {
    doSearch: async (input: SearchInput): Promise<SearchResult<CrmObject>> => {
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
          // Try numeric comparison first, fall back to string comparison
          const aNum = Number(aVal)
          const bNum = Number(bVal)
          let cmp: number
          if (!isNaN(aNum) && !isNaN(bNum)) {
            cmp = aNum - bNum
          } else {
            cmp = String(aVal).localeCompare(String(bVal))
          }
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

    getForecast: async (options: {
      pipelineId: string
      startDate: string
      endDate: string
    }): Promise<{
      totalValue: number
      weightedValue: number
      dealCount: number
    }> => {
      const startTime = new Date(options.startDate).getTime()
      const endTime = new Date(options.endDate).getTime()

      const dealsMap = await this.storage.list({ prefix: this.PREFIX })
      let totalValue = 0
      let weightedValue = 0
      let dealCount = 0

      // Get pipeline for probability data
      let pipeline: Pipeline | null = null
      if (this.pipelinesApi) {
        try {
          pipeline = await this.pipelinesApi.pipelinesApi.getById('deals', options.pipelineId)
        } catch {
          // Ignore if pipeline not found
        }
      }

      for (const [key, value] of dealsMap.entries()) {
        if (key.includes(':history') || key.includes(':stage_history')) continue
        const deal = value as any
        if (!deal.id || !deal.properties || deal.archived) continue

        const inPipeline = deal.properties.pipeline === options.pipelineId ||
          (options.pipelineId === 'default' && !deal.properties.pipeline)
        if (!inPipeline) continue

        // Check if deal close date is within range
        const closeDateStr = deal.properties.closedate
        if (closeDateStr) {
          const closeTime = new Date(closeDateStr).getTime()
          if (closeTime < startTime || closeTime > endTime) continue
        }

        // Only include open deals (not closed)
        const stage = deal.properties.dealstage
        if (stage === 'closedwon' || stage === 'closedlost') continue

        const amount = Number(deal.properties.amount) || 0
        totalValue += amount
        dealCount++

        // Calculate weighted value based on stage probability
        let probability = 0.5 // default
        if (pipeline) {
          const stageData = pipeline.stages.find((s) => s.id === stage)
          if (stageData?.metadata?.probability) {
            probability = Number(stageData.metadata.probability)
          }
        }
        weightedValue += amount * probability
      }

      return { totalValue, weightedValue, dealCount }
    },

    getForecastByOwner: async (options: {
      pipelineId: string
      startDate: string
      endDate: string
    }): Promise<{
      owners: Array<{
        ownerId: string
        totalValue: number
        weightedValue: number
        dealCount: number
      }>
    }> => {
      const startTime = new Date(options.startDate).getTime()
      const endTime = new Date(options.endDate).getTime()

      const dealsMap = await this.storage.list({ prefix: this.PREFIX })
      const ownerData = new Map<string, { totalValue: number; weightedValue: number; dealCount: number }>()

      // Get pipeline for probability data
      let pipeline: Pipeline | null = null
      if (this.pipelinesApi) {
        try {
          pipeline = await this.pipelinesApi.pipelinesApi.getById('deals', options.pipelineId)
        } catch {
          // Ignore
        }
      }

      for (const [key, value] of dealsMap.entries()) {
        if (key.includes(':history') || key.includes(':stage_history')) continue
        const deal = value as any
        if (!deal.id || !deal.properties || deal.archived) continue

        const inPipeline = deal.properties.pipeline === options.pipelineId ||
          (options.pipelineId === 'default' && !deal.properties.pipeline)
        if (!inPipeline) continue

        // Check close date range
        const closeDateStr = deal.properties.closedate
        if (closeDateStr) {
          const closeTime = new Date(closeDateStr).getTime()
          if (closeTime < startTime || closeTime > endTime) continue
        }

        const stage = deal.properties.dealstage
        if (stage === 'closedwon' || stage === 'closedlost') continue

        const ownerId = deal.properties.hubspot_owner_id || 'unassigned'
        const amount = Number(deal.properties.amount) || 0

        let probability = 0.5
        if (pipeline) {
          const stageData = pipeline.stages.find((s) => s.id === stage)
          if (stageData?.metadata?.probability) {
            probability = Number(stageData.metadata.probability)
          }
        }

        if (!ownerData.has(ownerId)) {
          ownerData.set(ownerId, { totalValue: 0, weightedValue: 0, dealCount: 0 })
        }
        const data = ownerData.get(ownerId)!
        data.totalValue += amount
        data.weightedValue += amount * probability
        data.dealCount++
      }

      return {
        owners: Array.from(ownerData.entries()).map(([ownerId, data]) => ({
          ownerId,
          ...data,
        })),
      }
    },

    getMonthlyForecast: async (options: {
      pipelineId: string
      year: number
    }): Promise<{
      months: Array<{
        month: number
        totalValue: number
        weightedValue: number
        dealCount: number
      }>
    }> => {
      const months = Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        totalValue: 0,
        weightedValue: 0,
        dealCount: 0,
      }))

      const dealsMap = await this.storage.list({ prefix: this.PREFIX })

      // Get pipeline for probability
      let pipeline: Pipeline | null = null
      if (this.pipelinesApi) {
        try {
          pipeline = await this.pipelinesApi.pipelinesApi.getById('deals', options.pipelineId)
        } catch {
          // Ignore
        }
      }

      for (const [key, value] of dealsMap.entries()) {
        if (key.includes(':history') || key.includes(':stage_history')) continue
        const deal = value as any
        if (!deal.id || !deal.properties || deal.archived) continue

        const inPipeline = deal.properties.pipeline === options.pipelineId ||
          (options.pipelineId === 'default' && !deal.properties.pipeline)
        if (!inPipeline) continue

        const closeDateStr = deal.properties.closedate
        if (!closeDateStr) continue

        const closeDate = new Date(closeDateStr)
        if (closeDate.getFullYear() !== options.year) continue

        const stage = deal.properties.dealstage
        if (stage === 'closedwon' || stage === 'closedlost') continue

        const monthIndex = closeDate.getMonth() // 0-based
        const amount = Number(deal.properties.amount) || 0

        let probability = 0.5
        if (pipeline) {
          const stageData = pipeline.stages.find((s) => s.id === stage)
          if (stageData?.metadata?.probability) {
            probability = Number(stageData.metadata.probability)
          }
        }

        months[monthIndex].totalValue += amount
        months[monthIndex].weightedValue += amount * probability
        months[monthIndex].dealCount++
      }

      return { months }
    },

    findStaleDeals: async (options: {
      pipelineId: string
      daysInStage: number
    }): Promise<{
      results: Array<CrmObject & { staleDays: number }>
      total: number
    }> => {
      const dealsMap = await this.storage.list({ prefix: this.PREFIX })
      const staleDeals: Array<CrmObject & { staleDays: number }> = []
      const thresholdMs = options.daysInStage * 24 * 60 * 60 * 1000
      const nowTime = Date.now()

      for (const [key, value] of dealsMap.entries()) {
        if (key.includes(':history') || key.includes(':stage_history')) continue
        const deal = value as any
        if (!deal.id || !deal.properties || deal.archived) continue

        const inPipeline = deal.properties.pipeline === options.pipelineId ||
          (options.pipelineId === 'default' && !deal.properties.pipeline)
        if (!inPipeline) continue

        // Skip closed deals
        const stage = deal.properties.dealstage
        if (stage === 'closedwon' || stage === 'closedlost') continue

        // Check how long the deal has been in current stage
        const updatedAt = new Date(deal.updatedAt).getTime()
        const daysInStage = Math.floor((nowTime - updatedAt) / (24 * 60 * 60 * 1000))

        if (daysInStage >= options.daysInStage) {
          staleDeals.push({
            ...deal,
            staleDays: daysInStage,
          })
        }
      }

      return {
        results: staleDeals,
        total: staleDeals.length,
      }
    },
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

      // Alias for getPage - HubSpot API uses getAll in some places
      getAll: async (
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

      read: async (
        fromObjectType: string,
        toObjectType: string,
        input: { inputs: Array<{ id: string }> }
      ): Promise<{
        results: Array<{
          from: { id: string }
          to: Array<{
            toObjectId: string | number
            associationTypes: Array<{ category: AssociationCategory; typeId: number; label?: string }>
          }>
        }>
        errors: Array<{ status: string; message: string; context?: Record<string, unknown> }>
      }> => {
        const results: Array<{
          from: { id: string }
          to: Array<{
            toObjectId: string | number
            associationTypes: Array<{ category: AssociationCategory; typeId: number; label?: string }>
          }>
        }> = []

        for (const item of input.inputs) {
          const associations = await this.v4.basicApi.getAll(
            fromObjectType,
            item.id,
            toObjectType
          )
          results.push({
            from: { id: item.id },
            to: associations.results,
          })
        }

        return { results, errors: [] }
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
    // Default deals pipeline with probability metadata
    const dealsPipeline: Pipeline = {
      id: 'default',
      label: 'Sales Pipeline',
      displayOrder: 0,
      stages: [
        { id: 'appointmentscheduled', label: 'Appointment Scheduled', displayOrder: 0, metadata: { probability: '0.2' } },
        { id: 'qualifiedtobuy', label: 'Qualified to Buy', displayOrder: 1, metadata: { probability: '0.4' } },
        { id: 'presentationscheduled', label: 'Presentation Scheduled', displayOrder: 2, metadata: { probability: '0.6' } },
        { id: 'decisionmakerboughtin', label: 'Decision Maker Bought-In', displayOrder: 3, metadata: { probability: '0.8' } },
        { id: 'contractsent', label: 'Contract Sent', displayOrder: 4, metadata: { probability: '0.9' } },
        { id: 'closedwon', label: 'Closed Won', displayOrder: 5, metadata: { probability: '1.0', isClosed: 'true' } },
        { id: 'closedlost', label: 'Closed Lost', displayOrder: 6, metadata: { probability: '0', isClosed: 'true' } },
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

    // Analytics methods
    getWeightedValue: async (objectType: string, pipelineId: string): Promise<{
      weightedValue: number
      totalValue: number
      dealCount: number
    }> => {
      const pipeline = await this.pipelinesApi.getById(objectType, pipelineId)

      // Get all deals in this pipeline
      const dealsMap = await this.storage.list({ prefix: 'crm:deals:' })
      const deals = Array.from(dealsMap.values()).filter((d: any) => {
        if (d.id && d.properties && !d.archived) {
          return d.properties.pipeline === pipelineId || (pipelineId === 'default' && !d.properties.pipeline)
        }
        return false
      }) as CrmObject[]

      let totalValue = 0
      let weightedValue = 0
      let dealCount = 0

      for (const deal of deals) {
        const amount = Number(deal.properties.amount) || 0
        const stage = pipeline.stages.find((s) => s.id === deal.properties.dealstage)
        const probability = stage?.metadata?.probability ? Number(stage.metadata.probability) : 0

        totalValue += amount
        weightedValue += amount * probability
        dealCount++
      }

      return { weightedValue, totalValue, dealCount }
    },

    getDealVelocity: async (objectType: string, pipelineId: string): Promise<{
      averageDaysToClose: number
      dealsClosed: number
    }> => {
      // Get all deals in this pipeline that are closed
      const dealsMap = await this.storage.list({ prefix: 'crm:deals:' })
      const closedDeals = Array.from(dealsMap.values()).filter((d: any) => {
        if (d.id && d.properties && !d.archived) {
          const inPipeline = d.properties.pipeline === pipelineId || (pipelineId === 'default' && !d.properties.pipeline)
          const isClosed = d.properties.dealstage === 'closedwon' || d.properties.dealstage === 'closedlost'
          return inPipeline && isClosed
        }
        return false
      }) as CrmObject[]

      if (closedDeals.length === 0) {
        return { averageDaysToClose: 0, dealsClosed: 0 }
      }

      let totalDays = 0
      for (const deal of closedDeals) {
        const createdAt = new Date(deal.createdAt).getTime()
        const updatedAt = new Date(deal.updatedAt).getTime()
        const days = (updatedAt - createdAt) / (1000 * 60 * 60 * 24)
        totalDays += days
      }

      return {
        averageDaysToClose: totalDays / closedDeals.length,
        dealsClosed: closedDeals.length,
      }
    },

    getConversionRates: async (objectType: string, pipelineId: string): Promise<{
      stages: Array<{
        stageId: string
        entryCount: number
        exitCount: number
        conversionRate: number
      }>
    }> => {
      const pipeline = await this.pipelinesApi.getById(objectType, pipelineId)

      // Get all deals in this pipeline
      const dealsMap = await this.storage.list({ prefix: 'crm:deals:' })
      const deals = Array.from(dealsMap.values()).filter((d: any) => {
        if (d.id && d.properties && !d.archived) {
          return d.properties.pipeline === pipelineId || (pipelineId === 'default' && !d.properties.pipeline)
        }
        return false
      }) as CrmObject[]

      const stageCounts = new Map<string, { entry: number; exit: number }>()
      for (const stage of pipeline.stages) {
        stageCounts.set(stage.id, { entry: 0, exit: 0 })
      }

      // Count deals by stage
      for (const deal of deals) {
        const stageId = deal.properties.dealstage
        if (stageId && stageCounts.has(stageId)) {
          const count = stageCounts.get(stageId)!
          count.entry++
        }
      }

      // Calculate conversion rates based on stage position
      const stages = pipeline.stages.map((stage, index) => {
        const counts = stageCounts.get(stage.id) || { entry: 0, exit: 0 }
        const nextStage = pipeline.stages[index + 1]
        const nextCounts = nextStage ? stageCounts.get(nextStage.id) : undefined
        const exitCount = nextCounts?.entry ?? 0

        return {
          stageId: stage.id,
          entryCount: counts.entry,
          exitCount,
          conversionRate: counts.entry > 0 ? (exitCount / counts.entry) * 100 : 0,
        }
      })

      return { stages }
    },

    getWinRate: async (objectType: string, pipelineId: string): Promise<{
      winRate: number
      wonCount: number
      lostCount: number
      totalClosed: number
    }> => {
      // Get all closed deals in this pipeline
      const dealsMap = await this.storage.list({ prefix: 'crm:deals:' })
      let wonCount = 0
      let lostCount = 0

      for (const deal of dealsMap.values() as IterableIterator<any>) {
        if (deal.id && deal.properties && !deal.archived) {
          const inPipeline = deal.properties.pipeline === pipelineId || (pipelineId === 'default' && !deal.properties.pipeline)
          if (inPipeline) {
            if (deal.properties.dealstage === 'closedwon') wonCount++
            if (deal.properties.dealstage === 'closedlost') lostCount++
          }
        }
      }

      const totalClosed = wonCount + lostCount
      const winRate = totalClosed > 0 ? (wonCount / totalClosed) * 100 : 0

      return { winRate, wonCount, lostCount, totalClosed }
    },

    getLossReasons: async (objectType: string, pipelineId: string): Promise<{
      reasons: Array<{
        reason: string
        count: number
        percentage: number
      }>
    }> => {
      // Get all lost deals in this pipeline
      const dealsMap = await this.storage.list({ prefix: 'crm:deals:' })
      const reasonCounts = new Map<string, number>()
      let totalLost = 0

      for (const deal of dealsMap.values() as IterableIterator<any>) {
        if (deal.id && deal.properties && !deal.archived) {
          const inPipeline = deal.properties.pipeline === pipelineId || (pipelineId === 'default' && !deal.properties.pipeline)
          if (inPipeline && deal.properties.dealstage === 'closedlost') {
            totalLost++
            const reason = deal.properties.closed_lost_reason || 'Unknown'
            reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1)
          }
        }
      }

      const reasons = Array.from(reasonCounts.entries()).map(([reason, count]) => ({
        reason,
        count,
        percentage: totalLost > 0 ? (count / totalLost) * 100 : 0,
      }))

      return { reasons }
    },

    configureRotation: async (objectType: string, pipelineId: string, config: {
      enabled: boolean
      method: 'round_robin' | 'weighted'
      ownerIds?: string[]
      weights?: Record<string, number>
      triggerStage: string
    }): Promise<{
      enabled: boolean
      method: 'round_robin' | 'weighted'
      ownerIds?: string[]
      weights?: Record<string, number>
      triggerStage: string
    }> => {
      // Store rotation config
      const rotationKey = `rotation:${objectType}:${pipelineId}`
      await this.storage.put(rotationKey, config)
      return config
    },

    configureStaleAlerts: async (objectType: string, pipelineId: string, config: {
      enabled: boolean
      thresholdDays: Record<string, number>
      notifyOwner: boolean
      notifyManager: boolean
    }): Promise<{
      enabled: boolean
      thresholdDays: Record<string, number>
      notifyOwner: boolean
      notifyManager: boolean
    }> => {
      // Store stale alerts config
      const alertsKey = `stale_alerts:${objectType}:${pipelineId}`
      await this.storage.put(alertsKey, config)
      return config
    },

    getHealthScore: async (objectType: string, pipelineId: string): Promise<{
      score: number
      factors: {
        staleDealsPercentage: number
        averageVelocity: number
        winRate: number
      }
    }> => {
      const velocity = await this.pipelinesApi.getDealVelocity(objectType, pipelineId)
      const winRateData = await this.pipelinesApi.getWinRate(objectType, pipelineId)

      // Get stale deals count
      const dealsMap = await this.storage.list({ prefix: 'crm:deals:' })
      let staleCount = 0
      let totalOpenDeals = 0
      const staleDaysThreshold = 30

      for (const deal of dealsMap.values() as IterableIterator<any>) {
        if (deal.id && deal.properties && !deal.archived) {
          const inPipeline = deal.properties.pipeline === pipelineId || (pipelineId === 'default' && !deal.properties.pipeline)
          const isOpen = deal.properties.dealstage !== 'closedwon' && deal.properties.dealstage !== 'closedlost'
          if (inPipeline && isOpen) {
            totalOpenDeals++
            const daysInStage = (Date.now() - new Date(deal.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
            if (daysInStage >= staleDaysThreshold) {
              staleCount++
            }
          }
        }
      }

      const staleDealsPercentage = totalOpenDeals > 0 ? (staleCount / totalOpenDeals) * 100 : 0

      // Calculate overall score (higher is better)
      // Win rate contributes 40%, velocity 30%, stale deals 30%
      const velocityScore = velocity.averageDaysToClose > 0 ? Math.max(0, 100 - velocity.averageDaysToClose) : 100
      const staleScore = 100 - staleDealsPercentage

      const score = Math.round(
        winRateData.winRate * 0.4 +
        velocityScore * 0.3 +
        staleScore * 0.3
      )

      return {
        score: Math.max(0, Math.min(100, score)),
        factors: {
          staleDealsPercentage,
          averageVelocity: velocity.averageDaysToClose,
          winRate: winRateData.winRate,
        },
      }
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
    deals: LocalDealsObjectApi
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

    // Initialize pipelines first (needed by deals API)
    const pipelines = new LocalPipelinesApi(this.storage)

    // Initialize deals API with pipeline reference
    const dealsApi = new LocalDealsObjectApi(this.storage, onObjectChange)
    dealsApi.setPipelinesApi(pipelines)

    // Initialize CRM APIs
    this.crm = {
      contacts: new LocalObjectApi(this.storage, 'contacts', onObjectChange),
      companies: new LocalObjectApi(this.storage, 'companies', onObjectChange),
      deals: dealsApi,
      tickets: new LocalObjectApi(this.storage, 'tickets', onObjectChange),
      lineItems: new LocalObjectApi(this.storage, 'line_items', onObjectChange),
      products: new LocalObjectApi(this.storage, 'products', onObjectChange),
      quotes: new LocalObjectApi(this.storage, 'quotes', onObjectChange),
      associations: new LocalAssociationsApi(this.storage),
      properties: new LocalPropertiesApi(this.storage),
      pipelines,
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
