/**
 * @dotdo/hubspot/crm - HubSpot CRM API Compatibility Layer with DO Storage
 *
 * Local implementation of HubSpot CRM APIs backed by Durable Objects storage.
 * Provides complete offline/edge support for CRM operations.
 *
 * @example
 * ```typescript
 * import { HubSpotCRM } from '@dotdo/hubspot/crm'
 *
 * // Create local CRM instance
 * const crm = new HubSpotCRM(ctx.storage)
 *
 * // Contacts
 * const contact = await crm.createContact({
 *   email: 'user@example.com',
 *   firstName: 'John',
 *   lastName: 'Doe',
 * })
 *
 * // Companies
 * const company = await crm.createCompany({
 *   name: 'Acme Inc',
 *   domain: 'acme.com',
 * })
 *
 * // Associate contact to company
 * await crm.associateContactToCompany(contact.id, company.id)
 *
 * // Search
 * const results = await crm.searchContacts('john', {
 *   filters: [{ field: 'lifecycleStage', operator: 'eq', value: 'lead' }],
 * })
 * ```
 *
 * @module @dotdo/hubspot/crm
 */

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Base HubSpot CRM object
 */
export interface CRMObject {
  id: string
  properties: Record<string, string | null>
  createdAt: string
  updatedAt: string
  archived: boolean
  archivedAt?: string
}

/**
 * Contact object
 */
export interface Contact extends CRMObject {
  properties: ContactProperties
}

export interface ContactProperties {
  email?: string | null
  firstname?: string | null
  lastname?: string | null
  phone?: string | null
  company?: string | null
  website?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  country?: string | null
  jobtitle?: string | null
  lifecyclestage?: string | null
  hs_lead_status?: string | null
  createdate?: string | null
  lastmodifieddate?: string | null
  hs_object_id?: string | null
  [key: string]: string | null | undefined
}

/**
 * Company object
 */
export interface Company extends CRMObject {
  properties: CompanyProperties
}

export interface CompanyProperties {
  name?: string | null
  domain?: string | null
  industry?: string | null
  description?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  country?: string | null
  website?: string | null
  numberofemployees?: string | null
  annualrevenue?: string | null
  type?: string | null
  createdate?: string | null
  lastmodifieddate?: string | null
  hs_object_id?: string | null
  [key: string]: string | null | undefined
}

/**
 * Deal object
 */
export interface Deal extends CRMObject {
  properties: DealProperties
}

export interface DealProperties {
  dealname?: string | null
  amount?: string | null
  dealstage?: string | null
  pipeline?: string | null
  closedate?: string | null
  hubspot_owner_id?: string | null
  description?: string | null
  dealtype?: string | null
  createdate?: string | null
  lastmodifieddate?: string | null
  hs_object_id?: string | null
  [key: string]: string | null | undefined
}

/**
 * Property definition
 */
export interface PropertyDefinition {
  name: string
  label: string
  type: PropertyType
  fieldType: PropertyFieldType
  description?: string
  groupName: string
  options?: PropertyOption[]
  displayOrder?: number
  hasUniqueValue?: boolean
  hidden?: boolean
  modificationMetadata?: {
    archivable: boolean
    readOnlyDefinition: boolean
    readOnlyValue: boolean
  }
  formField?: boolean
  calculated?: boolean
  externalOptions?: boolean
  archived?: boolean
  createdAt?: string
  updatedAt?: string
}

export type PropertyType =
  | 'string'
  | 'number'
  | 'date'
  | 'datetime'
  | 'enumeration'
  | 'bool'

export type PropertyFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'number'
  | 'file'
  | 'booleancheckbox'
  | 'calculation_equation'
  | 'phonenumber'

export interface PropertyOption {
  label: string
  value: string
  displayOrder?: number
  hidden?: boolean
  description?: string
}

/**
 * Property group
 */
export interface PropertyGroup {
  name: string
  label: string
  displayOrder: number
  archived?: boolean
}

/**
 * Association types
 */
export interface Association {
  id: string
  fromObjectType: CRMObjectType
  fromObjectId: string
  toObjectType: CRMObjectType
  toObjectId: string
  associationType: AssociationType
  createdAt: string
}

export type CRMObjectType =
  | 'contacts'
  | 'companies'
  | 'deals'
  | 'tickets'
  | 'notes'
  | 'emails'
  | 'calls'
  | 'meetings'
  | 'tasks'
  | string

export type AssociationType =
  | 'contact_to_company'
  | 'contact_to_deal'
  | 'company_to_deal'
  | 'deal_to_contact'
  | 'deal_to_company'
  | 'contact_to_ticket'
  | 'company_to_ticket'
  | 'engagement_to_contact'
  | 'engagement_to_company'
  | 'engagement_to_deal'
  | string

/**
 * Engagement types (activities)
 */
export interface Engagement extends CRMObject {
  type: EngagementType
}

export type EngagementType = 'note' | 'email' | 'call' | 'meeting' | 'task'

export interface EngagementMetadata {
  contactIds?: string[]
  companyIds?: string[]
  dealIds?: string[]
  ticketIds?: string[]
}

/**
 * Note engagement
 */
export interface Note extends Engagement {
  type: 'note'
  properties: {
    hs_note_body?: string | null
    hs_timestamp?: string | null
    hubspot_owner_id?: string | null
    [key: string]: string | null | undefined
  }
}

/**
 * Task engagement
 */
export interface Task extends Engagement {
  type: 'task'
  properties: {
    hs_task_subject?: string | null
    hs_task_body?: string | null
    hs_task_status?: string | null
    hs_task_priority?: string | null
    hs_timestamp?: string | null
    hs_task_due_date?: string | null
    hubspot_owner_id?: string | null
    [key: string]: string | null | undefined
  }
}

/**
 * Search filter
 */
export interface SearchFilter {
  field: string
  operator: FilterOperator
  value?: string
  values?: string[]
  highValue?: string
}

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'between'
  | 'in'
  | 'not_in'
  | 'has_property'
  | 'not_has_property'
  | 'contains_token'
  | 'not_contains_token'

/**
 * Search options
 */
export interface SearchOptions {
  filters?: SearchFilter[]
  sorts?: Array<{ field: string; direction: 'asc' | 'desc' }>
  properties?: string[]
  limit?: number
  after?: string
}

/**
 * Search result
 */
export interface SearchResult<T> {
  total: number
  results: T[]
  paging?: {
    next?: { after: string }
  }
}

/**
 * List result
 */
export interface ListResult<T> {
  results: T[]
  paging?: {
    next?: { after: string }
  }
}

/**
 * Batch result
 */
export interface BatchResult<T> {
  status: 'COMPLETE' | 'PENDING' | 'PROCESSING'
  results: T[]
  errors: Array<{
    status: string
    message: string
    context?: Record<string, unknown>
  }>
}

// =============================================================================
// Input Types
// =============================================================================

export interface CreateContactInput {
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  company?: string
  website?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  jobTitle?: string
  lifecycleStage?: string
  leadStatus?: string
  properties?: Record<string, string>
}

export interface CreateCompanyInput {
  name: string
  domain?: string
  industry?: string
  description?: string
  phone?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  website?: string
  numberOfEmployees?: number
  annualRevenue?: number
  type?: string
  properties?: Record<string, string>
}

export interface CreateDealInput {
  name: string
  amount?: number
  stage: string
  pipeline?: string
  closeDate?: string
  ownerId?: string
  description?: string
  dealType?: string
  properties?: Record<string, string>
}

export interface CreatePropertyInput {
  name: string
  type: PropertyType
  label: string
  fieldType?: PropertyFieldType
  groupName?: string
  description?: string
  options?: PropertyOption[]
  displayOrder?: number
  hasUniqueValue?: boolean
  hidden?: boolean
  formField?: boolean
}

export interface CreatePropertyGroupInput {
  name: string
  label: string
  displayOrder?: number
}

export interface CreateEngagementInput {
  type: EngagementType
  contactIds?: string[]
  companyIds?: string[]
  dealIds?: string[]
  ticketIds?: string[]
  metadata: Record<string, unknown>
}

export interface CreateNoteInput {
  content: string
  ownerId?: string
  timestamp?: string
}

export interface CreateTaskInput {
  subject: string
  body?: string
  dueDate?: string
  priority?: 'HIGH' | 'MEDIUM' | 'LOW'
  status?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'DEFERRED'
  assignee?: string
}

export interface CreateAssociationInput {
  fromObjectType: CRMObjectType
  fromObjectId: string
  toObjectType: CRMObjectType
  toObjectId: string
  associationType: AssociationType
}

// =============================================================================
// Storage Interface
// =============================================================================

/**
 * Storage interface for DO compatibility
 */
export interface CRMStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: { prefix?: string; limit?: number; start?: string }): Promise<Map<string, unknown>>
}

// =============================================================================
// HubSpotCRM Error
// =============================================================================

export class HubSpotCRMError extends Error {
  category: string
  statusCode: number
  correlationId: string
  context?: Record<string, unknown>

  constructor(
    message: string,
    category: string,
    statusCode: number = 400,
    context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'HubSpotCRMError'
    this.category = category
    this.statusCode = statusCode
    this.correlationId = generateId('correlation')
    this.context = context
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

function generateId(prefix: string = 'hs'): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

function now(): string {
  return new Date().toISOString()
}

function normalizeProperties(
  properties: Record<string, unknown>
): Record<string, string | null> {
  const normalized: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (value === null || value === undefined) {
      normalized[key] = null
    } else if (typeof value === 'number') {
      normalized[key] = String(value)
    } else if (typeof value === 'boolean') {
      normalized[key] = value ? 'true' : 'false'
    } else if (value instanceof Date) {
      normalized[key] = value.toISOString()
    } else {
      normalized[key] = String(value)
    }
  }
  return normalized
}

function matchesFilter(
  properties: Record<string, string | null>,
  filter: SearchFilter
): boolean {
  const value = properties[filter.field]
  const filterValue = filter.value

  switch (filter.operator) {
    case 'eq':
      return value === filterValue
    case 'neq':
      return value !== filterValue
    case 'lt':
      return value !== null && filterValue !== undefined && value < filterValue
    case 'lte':
      return value !== null && filterValue !== undefined && value <= filterValue
    case 'gt':
      return value !== null && filterValue !== undefined && value > filterValue
    case 'gte':
      return value !== null && filterValue !== undefined && value >= filterValue
    case 'between':
      return (
        value !== null &&
        filterValue !== undefined &&
        filter.highValue !== undefined &&
        value >= filterValue &&
        value <= filter.highValue
      )
    case 'in':
      return filter.values ? filter.values.includes(value ?? '') : false
    case 'not_in':
      return filter.values ? !filter.values.includes(value ?? '') : true
    case 'has_property':
      return value !== null && value !== undefined
    case 'not_has_property':
      return value === null || value === undefined
    case 'contains_token':
      return (
        value !== null &&
        filterValue !== undefined &&
        value.toLowerCase().includes(filterValue.toLowerCase())
      )
    case 'not_contains_token':
      return (
        value === null ||
        filterValue === undefined ||
        !value.toLowerCase().includes(filterValue.toLowerCase())
      )
    default:
      return true
  }
}

function matchesQuery(
  properties: Record<string, string | null>,
  query: string
): boolean {
  const queryLower = query.toLowerCase()
  return Object.values(properties).some(
    (value) => value !== null && value.toLowerCase().includes(queryLower)
  )
}

function selectProperties<T extends CRMObject>(
  obj: T,
  properties?: string[]
): T {
  if (!properties || properties.length === 0) {
    return obj
  }
  const selectedProps: Record<string, string | null> = {}
  for (const prop of properties) {
    if (prop in obj.properties) {
      selectedProps[prop] = obj.properties[prop] ?? null
    }
  }
  return { ...obj, properties: selectedProps as T['properties'] }
}

// =============================================================================
// HubSpotCRM Class
// =============================================================================

/**
 * HubSpot CRM compatibility layer with DO storage
 */
export class HubSpotCRM {
  private storage: CRMStorage

  // Storage key prefixes
  private readonly PREFIX = {
    contact: 'contact:',
    company: 'company:',
    deal: 'deal:',
    ticket: 'ticket:',
    engagement: 'engagement:',
    association: 'assoc:',
    property: 'prop:',
    propertyGroup: 'propgroup:',
  }

  constructor(storage: CRMStorage) {
    this.storage = storage
  }

  // ===========================================================================
  // Contacts API
  // ===========================================================================

  /**
   * Create a new contact
   */
  async createContact(input: CreateContactInput): Promise<Contact> {
    const id = generateId('contact')
    const timestamp = now()

    // Check for duplicate email
    const existingContacts = await this.listAllObjects<Contact>(this.PREFIX.contact)
    const duplicate = existingContacts.find(
      (c) => c.properties.email?.toLowerCase() === input.email.toLowerCase()
    )
    if (duplicate) {
      throw new HubSpotCRMError(
        `Contact already exists with email: ${input.email}`,
        'DUPLICATE_EMAIL',
        409
      )
    }

    const contact: Contact = {
      id,
      properties: {
        email: input.email,
        firstname: input.firstName ?? null,
        lastname: input.lastName ?? null,
        phone: input.phone ?? null,
        company: input.company ?? null,
        website: input.website ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        zip: input.zip ?? null,
        country: input.country ?? null,
        jobtitle: input.jobTitle ?? null,
        lifecyclestage: input.lifecycleStage ?? 'subscriber',
        hs_lead_status: input.leadStatus ?? null,
        createdate: timestamp,
        lastmodifieddate: timestamp,
        hs_object_id: id,
        ...normalizeProperties(input.properties ?? {}),
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    }

    await this.storage.put(`${this.PREFIX.contact}${id}`, contact)
    return contact
  }

  /**
   * Get a contact by ID
   */
  async getContact(
    contactId: string,
    options?: { properties?: string[] }
  ): Promise<Contact> {
    const contact = await this.storage.get<Contact>(
      `${this.PREFIX.contact}${contactId}`
    )
    if (!contact || contact.archived) {
      throw new HubSpotCRMError(
        `Contact not found: ${contactId}`,
        'OBJECT_NOT_FOUND',
        404
      )
    }
    return selectProperties(contact, options?.properties)
  }

  /**
   * Update a contact
   */
  async updateContact(
    contactId: string,
    properties: Record<string, string>
  ): Promise<Contact> {
    const contact = await this.getContact(contactId)
    const timestamp = now()

    const updatedContact: Contact = {
      ...contact,
      properties: {
        ...contact.properties,
        ...normalizeProperties(properties),
        lastmodifieddate: timestamp,
      },
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.contact}${contactId}`, updatedContact)
    return updatedContact
  }

  /**
   * Delete a contact (hard delete)
   */
  async deleteContact(contactId: string): Promise<void> {
    const contact = await this.getContact(contactId)
    await this.storage.delete(`${this.PREFIX.contact}${contactId}`)
    // Clean up associations
    await this.deleteAssociationsForObject('contacts', contactId)
  }

  /**
   * Archive a contact (soft delete)
   */
  async archiveContact(contactId: string): Promise<Contact> {
    const contact = await this.getContact(contactId)
    const timestamp = now()

    const archivedContact: Contact = {
      ...contact,
      archived: true,
      archivedAt: timestamp,
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.contact}${contactId}`, archivedContact)
    return archivedContact
  }

  /**
   * Search contacts
   */
  async searchContacts(
    query: string,
    options?: SearchOptions
  ): Promise<SearchResult<Contact>> {
    const allContacts = await this.listAllObjects<Contact>(this.PREFIX.contact)

    let filtered = allContacts.filter((c) => !c.archived)

    // Apply text search
    if (query) {
      filtered = filtered.filter((c) => matchesQuery(c.properties, query))
    }

    // Apply filters
    if (options?.filters) {
      for (const filter of options.filters) {
        filtered = filtered.filter((c) =>
          matchesFilter(c.properties, filter)
        )
      }
    }

    // Apply sorting
    if (options?.sorts && options.sorts.length > 0) {
      filtered.sort((a, b) => {
        for (const sort of options.sorts!) {
          const aVal = a.properties[sort.field] ?? ''
          const bVal = b.properties[sort.field] ?? ''
          const cmp = aVal.localeCompare(bVal)
          if (cmp !== 0) {
            return sort.direction === 'asc' ? cmp : -cmp
          }
        }
        return 0
      })
    }

    // Pagination
    const limit = options?.limit ?? 100
    const afterIndex = options?.after
      ? filtered.findIndex((c) => c.id === options.after) + 1
      : 0
    const paged = filtered.slice(afterIndex, afterIndex + limit)
    const hasMore = afterIndex + limit < filtered.length

    // Select properties
    const results = paged.map((c) =>
      selectProperties(c, options?.properties)
    )

    return {
      total: filtered.length,
      results,
      paging: hasMore
        ? { next: { after: paged[paged.length - 1]?.id ?? '' } }
        : undefined,
    }
  }

  /**
   * Batch create contacts
   */
  async batchCreateContacts(
    contacts: CreateContactInput[]
  ): Promise<BatchResult<Contact>> {
    const results: Contact[] = []
    const errors: Array<{ status: string; message: string; context?: Record<string, unknown> }> = []

    for (const input of contacts) {
      try {
        const contact = await this.createContact(input)
        results.push(contact)
      } catch (error) {
        errors.push({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
          context: { email: input.email },
        })
      }
    }

    return { status: 'COMPLETE', results, errors }
  }

  /**
   * Batch update contacts
   */
  async batchUpdateContacts(
    updates: Array<{ id: string; properties: Record<string, string> }>
  ): Promise<BatchResult<Contact>> {
    const results: Contact[] = []
    const errors: Array<{ status: string; message: string; context?: Record<string, unknown> }> = []

    for (const update of updates) {
      try {
        const contact = await this.updateContact(update.id, update.properties)
        results.push(contact)
      } catch (error) {
        errors.push({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
          context: { id: update.id },
        })
      }
    }

    return { status: 'COMPLETE', results, errors }
  }

  /**
   * Merge two contacts (merge secondaryId into primaryId)
   */
  async mergeContacts(
    primaryId: string,
    secondaryId: string
  ): Promise<Contact> {
    const primary = await this.getContact(primaryId)
    const secondary = await this.getContact(secondaryId)
    const timestamp = now()

    // Merge properties (primary wins on conflicts)
    const mergedProps: Record<string, string | null> = { ...secondary.properties }
    for (const [key, value] of Object.entries(primary.properties)) {
      if (value !== null && value !== undefined && value !== '') {
        mergedProps[key] = value
      }
    }
    mergedProps.lastmodifieddate = timestamp

    const mergedContact: Contact = {
      ...primary,
      properties: mergedProps as ContactProperties,
      updatedAt: timestamp,
    }

    // Transfer associations from secondary to primary
    const secondaryAssocs = await this.listAssociations(
      'contacts',
      secondaryId,
      undefined as unknown as CRMObjectType
    )
    for (const assoc of secondaryAssocs.results) {
      await this.createAssociation(
        'contacts',
        primaryId,
        assoc.toObjectType,
        assoc.toObjectId,
        assoc.associationType
      )
    }

    // Archive secondary
    await this.archiveContact(secondaryId)

    // Save merged primary
    await this.storage.put(`${this.PREFIX.contact}${primaryId}`, mergedContact)

    return mergedContact
  }

  // ===========================================================================
  // Companies API
  // ===========================================================================

  /**
   * Create a new company
   */
  async createCompany(input: CreateCompanyInput): Promise<Company> {
    const id = generateId('company')
    const timestamp = now()

    const company: Company = {
      id,
      properties: {
        name: input.name,
        domain: input.domain ?? null,
        industry: input.industry ?? null,
        description: input.description ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        zip: input.zip ?? null,
        country: input.country ?? null,
        website: input.website ?? null,
        numberofemployees: input.numberOfEmployees?.toString() ?? null,
        annualrevenue: input.annualRevenue?.toString() ?? null,
        type: input.type ?? null,
        createdate: timestamp,
        lastmodifieddate: timestamp,
        hs_object_id: id,
        ...normalizeProperties(input.properties ?? {}),
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    }

    await this.storage.put(`${this.PREFIX.company}${id}`, company)
    return company
  }

  /**
   * Get a company by ID
   */
  async getCompany(
    companyId: string,
    options?: { properties?: string[] }
  ): Promise<Company> {
    const company = await this.storage.get<Company>(
      `${this.PREFIX.company}${companyId}`
    )
    if (!company || company.archived) {
      throw new HubSpotCRMError(
        `Company not found: ${companyId}`,
        'OBJECT_NOT_FOUND',
        404
      )
    }
    return selectProperties(company, options?.properties)
  }

  /**
   * Update a company
   */
  async updateCompany(
    companyId: string,
    properties: Record<string, string>
  ): Promise<Company> {
    const company = await this.getCompany(companyId)
    const timestamp = now()

    const updatedCompany: Company = {
      ...company,
      properties: {
        ...company.properties,
        ...normalizeProperties(properties),
        lastmodifieddate: timestamp,
      },
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.company}${companyId}`, updatedCompany)
    return updatedCompany
  }

  /**
   * Delete a company
   */
  async deleteCompany(companyId: string): Promise<void> {
    await this.getCompany(companyId)
    await this.storage.delete(`${this.PREFIX.company}${companyId}`)
    await this.deleteAssociationsForObject('companies', companyId)
  }

  /**
   * Search companies
   */
  async searchCompanies(
    query: string,
    options?: SearchOptions
  ): Promise<SearchResult<Company>> {
    const allCompanies = await this.listAllObjects<Company>(this.PREFIX.company)

    let filtered = allCompanies.filter((c) => !c.archived)

    if (query) {
      filtered = filtered.filter((c) => matchesQuery(c.properties, query))
    }

    if (options?.filters) {
      for (const filter of options.filters) {
        filtered = filtered.filter((c) =>
          matchesFilter(c.properties, filter)
        )
      }
    }

    if (options?.sorts && options.sorts.length > 0) {
      filtered.sort((a, b) => {
        for (const sort of options.sorts!) {
          const aVal = a.properties[sort.field] ?? ''
          const bVal = b.properties[sort.field] ?? ''
          const cmp = aVal.localeCompare(bVal)
          if (cmp !== 0) {
            return sort.direction === 'asc' ? cmp : -cmp
          }
        }
        return 0
      })
    }

    const limit = options?.limit ?? 100
    const afterIndex = options?.after
      ? filtered.findIndex((c) => c.id === options.after) + 1
      : 0
    const paged = filtered.slice(afterIndex, afterIndex + limit)
    const hasMore = afterIndex + limit < filtered.length

    return {
      total: filtered.length,
      results: paged,
      paging: hasMore
        ? { next: { after: paged[paged.length - 1]?.id ?? '' } }
        : undefined,
    }
  }

  /**
   * Batch create companies
   */
  async batchCreateCompanies(
    companies: CreateCompanyInput[]
  ): Promise<BatchResult<Company>> {
    const results: Company[] = []
    const errors: Array<{ status: string; message: string; context?: Record<string, unknown> }> = []

    for (const input of companies) {
      try {
        const company = await this.createCompany(input)
        results.push(company)
      } catch (error) {
        errors.push({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
          context: { name: input.name },
        })
      }
    }

    return { status: 'COMPLETE', results, errors }
  }

  /**
   * Associate a contact to a company
   */
  async associateContactToCompany(
    contactId: string,
    companyId: string
  ): Promise<Association> {
    // Verify both objects exist
    await this.getContact(contactId)
    await this.getCompany(companyId)

    return this.createAssociation(
      'contacts',
      contactId,
      'companies',
      companyId,
      'contact_to_company'
    )
  }

  /**
   * List contacts associated with a company
   */
  async listCompanyContacts(companyId: string): Promise<ListResult<Contact>> {
    await this.getCompany(companyId)

    const associations = await this.listAssociations(
      'companies',
      companyId,
      'contacts'
    )

    const contacts: Contact[] = []
    for (const assoc of associations.results) {
      try {
        const contact = await this.getContact(assoc.toObjectId)
        contacts.push(contact)
      } catch {
        // Contact may have been deleted
      }
    }

    return { results: contacts }
  }

  // ===========================================================================
  // Deals API
  // ===========================================================================

  /**
   * Create a new deal
   */
  async createDeal(input: CreateDealInput): Promise<Deal> {
    const id = generateId('deal')
    const timestamp = now()

    const deal: Deal = {
      id,
      properties: {
        dealname: input.name,
        amount: input.amount?.toString() ?? null,
        dealstage: input.stage,
        pipeline: input.pipeline ?? 'default',
        closedate: input.closeDate ?? null,
        hubspot_owner_id: input.ownerId ?? null,
        description: input.description ?? null,
        dealtype: input.dealType ?? null,
        createdate: timestamp,
        lastmodifieddate: timestamp,
        hs_object_id: id,
        ...normalizeProperties(input.properties ?? {}),
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    }

    await this.storage.put(`${this.PREFIX.deal}${id}`, deal)
    return deal
  }

  /**
   * Get a deal by ID
   */
  async getDeal(
    dealId: string,
    options?: { properties?: string[]; associations?: CRMObjectType[] }
  ): Promise<Deal & { associations?: Record<string, { results: Association[] }> }> {
    const deal = await this.storage.get<Deal>(`${this.PREFIX.deal}${dealId}`)
    if (!deal || deal.archived) {
      throw new HubSpotCRMError(
        `Deal not found: ${dealId}`,
        'OBJECT_NOT_FOUND',
        404
      )
    }

    const result = selectProperties(deal, options?.properties) as Deal & {
      associations?: Record<string, { results: Association[] }>
    }

    if (options?.associations) {
      result.associations = {}
      for (const assocType of options.associations) {
        const assocs = await this.listAssociations('deals', dealId, assocType)
        result.associations[assocType] = assocs
      }
    }

    return result
  }

  /**
   * Update a deal
   */
  async updateDeal(
    dealId: string,
    properties: Record<string, string>
  ): Promise<Deal> {
    const deal = await this.getDeal(dealId)
    const timestamp = now()

    const updatedDeal: Deal = {
      ...deal,
      properties: {
        ...deal.properties,
        ...normalizeProperties(properties),
        lastmodifieddate: timestamp,
      },
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.deal}${dealId}`, updatedDeal)
    return updatedDeal
  }

  /**
   * Delete a deal
   */
  async deleteDeal(dealId: string): Promise<void> {
    await this.getDeal(dealId)
    await this.storage.delete(`${this.PREFIX.deal}${dealId}`)
    await this.deleteAssociationsForObject('deals', dealId)
  }

  /**
   * Move a deal to a different stage
   */
  async moveDealToStage(dealId: string, stageId: string): Promise<Deal> {
    return this.updateDeal(dealId, { dealstage: stageId })
  }

  /**
   * Search deals
   */
  async searchDeals(
    query: string,
    options?: SearchOptions
  ): Promise<SearchResult<Deal>> {
    const allDeals = await this.listAllObjects<Deal>(this.PREFIX.deal)

    let filtered = allDeals.filter((d) => !d.archived)

    if (query) {
      filtered = filtered.filter((d) => matchesQuery(d.properties, query))
    }

    if (options?.filters) {
      for (const filter of options.filters) {
        filtered = filtered.filter((d) =>
          matchesFilter(d.properties, filter)
        )
      }
    }

    if (options?.sorts && options.sorts.length > 0) {
      filtered.sort((a, b) => {
        for (const sort of options.sorts!) {
          const aVal = a.properties[sort.field] ?? ''
          const bVal = b.properties[sort.field] ?? ''
          const cmp = aVal.localeCompare(bVal)
          if (cmp !== 0) {
            return sort.direction === 'asc' ? cmp : -cmp
          }
        }
        return 0
      })
    }

    const limit = options?.limit ?? 100
    const afterIndex = options?.after
      ? filtered.findIndex((d) => d.id === options.after) + 1
      : 0
    const paged = filtered.slice(afterIndex, afterIndex + limit)
    const hasMore = afterIndex + limit < filtered.length

    return {
      total: filtered.length,
      results: paged,
      paging: hasMore
        ? { next: { after: paged[paged.length - 1]?.id ?? '' } }
        : undefined,
    }
  }

  /**
   * Associate a deal to a contact
   */
  async associateDealToContact(
    dealId: string,
    contactId: string
  ): Promise<Association> {
    await this.getDeal(dealId)
    await this.getContact(contactId)

    return this.createAssociation(
      'deals',
      dealId,
      'contacts',
      contactId,
      'deal_to_contact'
    )
  }

  /**
   * Associate a deal to a company
   */
  async associateDealToCompany(
    dealId: string,
    companyId: string
  ): Promise<Association> {
    await this.getDeal(dealId)
    await this.getCompany(companyId)

    return this.createAssociation(
      'deals',
      dealId,
      'companies',
      companyId,
      'deal_to_company'
    )
  }

  // ===========================================================================
  // Properties API
  // ===========================================================================

  /**
   * Get a property definition
   */
  async getPropertyDefinition(
    objectType: CRMObjectType,
    propertyName: string
  ): Promise<PropertyDefinition> {
    const key = `${this.PREFIX.property}${objectType}:${propertyName}`
    const prop = await this.storage.get<PropertyDefinition>(key)
    if (!prop) {
      throw new HubSpotCRMError(
        `Property not found: ${propertyName} for ${objectType}`,
        'PROPERTY_NOT_FOUND',
        404
      )
    }
    return prop
  }

  /**
   * List all properties for an object type
   */
  async listProperties(
    objectType: CRMObjectType,
    options?: { archived?: boolean }
  ): Promise<ListResult<PropertyDefinition>> {
    const prefix = `${this.PREFIX.property}${objectType}:`
    const propsMap = await this.storage.list({ prefix })

    const props: PropertyDefinition[] = []
    for (const value of propsMap.values()) {
      const prop = value as PropertyDefinition
      if (options?.archived === undefined || prop.archived === options.archived) {
        props.push(prop)
      }
    }

    // Sort by displayOrder
    props.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))

    return { results: props }
  }

  /**
   * Create a property definition
   */
  async createProperty(
    objectType: CRMObjectType,
    input: CreatePropertyInput
  ): Promise<PropertyDefinition> {
    const key = `${this.PREFIX.property}${objectType}:${input.name}`
    const timestamp = now()

    // Check if exists
    const existing = await this.storage.get<PropertyDefinition>(key)
    if (existing) {
      throw new HubSpotCRMError(
        `Property already exists: ${input.name}`,
        'PROPERTY_EXISTS',
        409
      )
    }

    const prop: PropertyDefinition = {
      name: input.name,
      label: input.label,
      type: input.type,
      fieldType: input.fieldType ?? 'text',
      groupName: input.groupName ?? 'default',
      description: input.description,
      options: input.options,
      displayOrder: input.displayOrder ?? 0,
      hasUniqueValue: input.hasUniqueValue ?? false,
      hidden: input.hidden ?? false,
      formField: input.formField ?? true,
      calculated: false,
      externalOptions: false,
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    await this.storage.put(key, prop)
    return prop
  }

  /**
   * Update a property definition
   */
  async updateProperty(
    objectType: CRMObjectType,
    propertyName: string,
    updates: Partial<Omit<CreatePropertyInput, 'name' | 'type'>>
  ): Promise<PropertyDefinition> {
    const prop = await this.getPropertyDefinition(objectType, propertyName)
    const timestamp = now()

    const updatedProp: PropertyDefinition = {
      ...prop,
      ...updates,
      updatedAt: timestamp,
    }

    const key = `${this.PREFIX.property}${objectType}:${propertyName}`
    await this.storage.put(key, updatedProp)
    return updatedProp
  }

  /**
   * Get a property group
   */
  async getPropertyGroup(
    objectType: CRMObjectType,
    groupName: string
  ): Promise<PropertyGroup> {
    const key = `${this.PREFIX.propertyGroup}${objectType}:${groupName}`
    const group = await this.storage.get<PropertyGroup>(key)
    if (!group) {
      throw new HubSpotCRMError(
        `Property group not found: ${groupName} for ${objectType}`,
        'PROPERTY_GROUP_NOT_FOUND',
        404
      )
    }
    return group
  }

  /**
   * Create a property group
   */
  async createPropertyGroup(
    objectType: CRMObjectType,
    input: CreatePropertyGroupInput
  ): Promise<PropertyGroup> {
    const key = `${this.PREFIX.propertyGroup}${objectType}:${input.name}`

    const existing = await this.storage.get<PropertyGroup>(key)
    if (existing) {
      throw new HubSpotCRMError(
        `Property group already exists: ${input.name}`,
        'PROPERTY_GROUP_EXISTS',
        409
      )
    }

    const group: PropertyGroup = {
      name: input.name,
      label: input.label,
      displayOrder: input.displayOrder ?? 0,
      archived: false,
    }

    await this.storage.put(key, group)
    return group
  }

  // ===========================================================================
  // Associations API
  // ===========================================================================

  /**
   * Create an association between objects
   */
  async createAssociation(
    fromType: CRMObjectType,
    fromId: string,
    toType: CRMObjectType,
    toId: string,
    associationType: AssociationType
  ): Promise<Association> {
    const id = generateId('assoc')
    const timestamp = now()

    const association: Association = {
      id,
      fromObjectType: fromType,
      fromObjectId: fromId,
      toObjectType: toType,
      toObjectId: toId,
      associationType,
      createdAt: timestamp,
    }

    // Store with composite key for efficient lookups
    const key = `${this.PREFIX.association}${fromType}:${fromId}:${toType}:${toId}`
    await this.storage.put(key, association)

    // Also store reverse association for bidirectional lookups
    const reverseAssociation: Association = {
      ...association,
      id: generateId('assoc'),
      fromObjectType: toType,
      fromObjectId: toId,
      toObjectType: fromType,
      toObjectId: fromId,
    }
    const reverseKey = `${this.PREFIX.association}${toType}:${toId}:${fromType}:${fromId}`
    await this.storage.put(reverseKey, reverseAssociation)

    return association
  }

  /**
   * Delete an association
   */
  async deleteAssociation(
    fromType: CRMObjectType,
    fromId: string,
    toType: CRMObjectType,
    toId: string
  ): Promise<void> {
    const key = `${this.PREFIX.association}${fromType}:${fromId}:${toType}:${toId}`
    await this.storage.delete(key)

    // Delete reverse
    const reverseKey = `${this.PREFIX.association}${toType}:${toId}:${fromType}:${fromId}`
    await this.storage.delete(reverseKey)
  }

  /**
   * List associations for an object
   */
  async listAssociations(
    objectType: CRMObjectType,
    objectId: string,
    toObjectType?: CRMObjectType
  ): Promise<ListResult<Association>> {
    const prefix = toObjectType
      ? `${this.PREFIX.association}${objectType}:${objectId}:${toObjectType}:`
      : `${this.PREFIX.association}${objectType}:${objectId}:`

    const assocsMap = await this.storage.list({ prefix })
    const results: Association[] = Array.from(assocsMap.values()) as Association[]

    return { results }
  }

  /**
   * Batch create associations
   */
  async batchCreateAssociations(
    associations: CreateAssociationInput[]
  ): Promise<BatchResult<Association>> {
    const results: Association[] = []
    const errors: Array<{ status: string; message: string; context?: Record<string, unknown> }> = []

    for (const input of associations) {
      try {
        const assoc = await this.createAssociation(
          input.fromObjectType,
          input.fromObjectId,
          input.toObjectType,
          input.toObjectId,
          input.associationType
        )
        results.push(assoc)
      } catch (error) {
        errors.push({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
          context: {
            from: `${input.fromObjectType}:${input.fromObjectId}`,
            to: `${input.toObjectType}:${input.toObjectId}`,
          },
        })
      }
    }

    return { status: 'COMPLETE', results, errors }
  }

  // ===========================================================================
  // CRM Objects Generic API
  // ===========================================================================

  /**
   * Get any CRM object by type and ID
   */
  async getObject(
    objectType: CRMObjectType,
    objectId: string,
    options?: { properties?: string[] }
  ): Promise<CRMObject> {
    const prefix = this.getPrefixForType(objectType)
    const obj = await this.storage.get<CRMObject>(`${prefix}${objectId}`)
    if (!obj || obj.archived) {
      throw new HubSpotCRMError(
        `${objectType} not found: ${objectId}`,
        'OBJECT_NOT_FOUND',
        404
      )
    }
    return selectProperties(obj, options?.properties)
  }

  /**
   * Create any CRM object
   */
  async createObject(
    objectType: CRMObjectType,
    properties: Record<string, string>
  ): Promise<CRMObject> {
    const id = generateId(objectType.slice(0, -1)) // Remove 's' from plural
    const timestamp = now()
    const prefix = this.getPrefixForType(objectType)

    const obj: CRMObject = {
      id,
      properties: {
        ...normalizeProperties(properties),
        createdate: timestamp,
        lastmodifieddate: timestamp,
        hs_object_id: id,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    }

    await this.storage.put(`${prefix}${id}`, obj)
    return obj
  }

  /**
   * Update any CRM object
   */
  async updateObject(
    objectType: CRMObjectType,
    objectId: string,
    properties: Record<string, string>
  ): Promise<CRMObject> {
    const prefix = this.getPrefixForType(objectType)
    const obj = await this.getObject(objectType, objectId)
    const timestamp = now()

    const updatedObj: CRMObject = {
      ...obj,
      properties: {
        ...obj.properties,
        ...normalizeProperties(properties),
        lastmodifieddate: timestamp,
      },
      updatedAt: timestamp,
    }

    await this.storage.put(`${prefix}${objectId}`, updatedObj)
    return updatedObj
  }

  /**
   * Delete any CRM object
   */
  async deleteObject(objectType: CRMObjectType, objectId: string): Promise<void> {
    const prefix = this.getPrefixForType(objectType)
    await this.getObject(objectType, objectId)
    await this.storage.delete(`${prefix}${objectId}`)
    await this.deleteAssociationsForObject(objectType, objectId)
  }

  /**
   * Search any CRM object type
   */
  async searchObjects(
    objectType: CRMObjectType,
    query: string,
    options?: SearchOptions
  ): Promise<SearchResult<CRMObject>> {
    const prefix = this.getPrefixForType(objectType)
    const allObjects = await this.listAllObjects<CRMObject>(prefix)

    let filtered = allObjects.filter((o) => !o.archived)

    if (query) {
      filtered = filtered.filter((o) => matchesQuery(o.properties, query))
    }

    if (options?.filters) {
      for (const filter of options.filters) {
        filtered = filtered.filter((o) =>
          matchesFilter(o.properties, filter)
        )
      }
    }

    if (options?.sorts && options.sorts.length > 0) {
      filtered.sort((a, b) => {
        for (const sort of options.sorts!) {
          const aVal = a.properties[sort.field] ?? ''
          const bVal = b.properties[sort.field] ?? ''
          const cmp = aVal.localeCompare(bVal)
          if (cmp !== 0) {
            return sort.direction === 'asc' ? cmp : -cmp
          }
        }
        return 0
      })
    }

    const limit = options?.limit ?? 100
    const afterIndex = options?.after
      ? filtered.findIndex((o) => o.id === options.after) + 1
      : 0
    const paged = filtered.slice(afterIndex, afterIndex + limit)
    const hasMore = afterIndex + limit < filtered.length

    return {
      total: filtered.length,
      results: paged,
      paging: hasMore
        ? { next: { after: paged[paged.length - 1]?.id ?? '' } }
        : undefined,
    }
  }

  // ===========================================================================
  // Activity Timeline API
  // ===========================================================================

  /**
   * Create an engagement (note, email, call, meeting, task)
   */
  async createEngagement(
    type: EngagementType,
    metadata: EngagementMetadata & Record<string, unknown>
  ): Promise<Engagement> {
    const id = generateId('engagement')
    const timestamp = now()

    const engagement: Engagement = {
      id,
      type,
      properties: {
        hs_timestamp: timestamp,
        hs_engagement_type: type,
        ...normalizeProperties(metadata),
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    }

    await this.storage.put(`${this.PREFIX.engagement}${id}`, engagement)

    // Create associations
    if (metadata.contactIds) {
      for (const contactId of metadata.contactIds) {
        await this.createAssociation(
          'engagement',
          id,
          'contacts',
          contactId,
          'engagement_to_contact'
        )
      }
    }
    if (metadata.companyIds) {
      for (const companyId of metadata.companyIds) {
        await this.createAssociation(
          'engagement',
          id,
          'companies',
          companyId,
          'engagement_to_company'
        )
      }
    }
    if (metadata.dealIds) {
      for (const dealId of metadata.dealIds) {
        await this.createAssociation(
          'engagement',
          id,
          'deals',
          dealId,
          'engagement_to_deal'
        )
      }
    }

    return engagement
  }

  /**
   * Get engagements for an object
   */
  async getEngagements(
    objectType: CRMObjectType,
    objectId: string
  ): Promise<ListResult<Engagement>> {
    // Get associations to engagements
    const assocs = await this.listAssociations(objectType, objectId)
    const engagementAssocs = assocs.results.filter(
      (a) => a.toObjectType === 'engagement' || a.fromObjectType === 'engagement'
    )

    const engagements: Engagement[] = []
    for (const assoc of engagementAssocs) {
      const engagementId =
        assoc.toObjectType === 'engagement' ? assoc.toObjectId : assoc.fromObjectId
      try {
        const engagement = await this.storage.get<Engagement>(
          `${this.PREFIX.engagement}${engagementId}`
        )
        if (engagement && !engagement.archived) {
          engagements.push(engagement)
        }
      } catch {
        // Engagement may have been deleted
      }
    }

    // Sort by timestamp descending
    engagements.sort((a, b) => {
      const aTime = a.properties.hs_timestamp ?? a.createdAt
      const bTime = b.properties.hs_timestamp ?? b.createdAt
      return bTime.localeCompare(aTime)
    })

    return { results: engagements }
  }

  /**
   * Create a note for an object
   */
  async createNote(
    objectType: CRMObjectType,
    objectId: string,
    content: string,
    options?: CreateNoteInput
  ): Promise<Note> {
    const id = generateId('note')
    const timestamp = options?.timestamp ?? now()

    const note: Note = {
      id,
      type: 'note',
      properties: {
        hs_note_body: content,
        hs_timestamp: timestamp,
        hubspot_owner_id: options?.ownerId ?? null,
        createdate: timestamp,
        lastmodifieddate: timestamp,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    }

    await this.storage.put(`${this.PREFIX.engagement}${id}`, note)

    // Create association
    await this.createAssociation(
      'notes',
      id,
      objectType,
      objectId,
      `engagement_to_${objectType.slice(0, -1)}` as AssociationType
    )

    return note
  }

  /**
   * Create a task for an object
   */
  async createTask(
    objectType: CRMObjectType,
    objectId: string,
    input: CreateTaskInput
  ): Promise<Task> {
    const id = generateId('task')
    const timestamp = now()

    const task: Task = {
      id,
      type: 'task',
      properties: {
        hs_task_subject: input.subject,
        hs_task_body: input.body ?? null,
        hs_task_status: input.status ?? 'NOT_STARTED',
        hs_task_priority: input.priority ?? 'MEDIUM',
        hs_timestamp: timestamp,
        hs_task_due_date: input.dueDate ?? null,
        hubspot_owner_id: input.assignee ?? null,
        createdate: timestamp,
        lastmodifieddate: timestamp,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    }

    await this.storage.put(`${this.PREFIX.engagement}${id}`, task)

    // Create association
    await this.createAssociation(
      'tasks',
      id,
      objectType,
      objectId,
      `engagement_to_${objectType.slice(0, -1)}` as AssociationType
    )

    return task
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  private getPrefixForType(objectType: CRMObjectType): string {
    const prefixMap: Record<string, string> = {
      contacts: this.PREFIX.contact,
      companies: this.PREFIX.company,
      deals: this.PREFIX.deal,
      tickets: this.PREFIX.ticket,
      notes: this.PREFIX.engagement,
      emails: this.PREFIX.engagement,
      calls: this.PREFIX.engagement,
      meetings: this.PREFIX.engagement,
      tasks: this.PREFIX.engagement,
    }
    return prefixMap[objectType] ?? `${objectType}:`
  }

  private async listAllObjects<T>(prefix: string): Promise<T[]> {
    const map = await this.storage.list({ prefix })
    return Array.from(map.values()) as T[]
  }

  private async deleteAssociationsForObject(
    objectType: CRMObjectType,
    objectId: string
  ): Promise<void> {
    const prefix = `${this.PREFIX.association}${objectType}:${objectId}:`
    const assocs = await this.storage.list({ prefix })

    for (const [key] of assocs) {
      await this.storage.delete(key as string)
    }

    // Also delete reverse associations
    const allAssocs = await this.storage.list({ prefix: this.PREFIX.association })
    for (const [key, value] of allAssocs) {
      const assoc = value as Association
      if (
        assoc.toObjectType === objectType &&
        assoc.toObjectId === objectId
      ) {
        await this.storage.delete(key as string)
      }
    }
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Clear all data (for testing)
   */
  async clear(): Promise<void> {
    for (const prefix of Object.values(this.PREFIX)) {
      const items = await this.storage.list({ prefix })
      for (const key of items.keys()) {
        await this.storage.delete(key as string)
      }
    }
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    contacts: number
    companies: number
    deals: number
    engagements: number
    associations: number
  }> {
    const contacts = await this.storage.list({ prefix: this.PREFIX.contact })
    const companies = await this.storage.list({ prefix: this.PREFIX.company })
    const deals = await this.storage.list({ prefix: this.PREFIX.deal })
    const engagements = await this.storage.list({ prefix: this.PREFIX.engagement })
    const associations = await this.storage.list({ prefix: this.PREFIX.association })

    return {
      contacts: contacts.size,
      companies: companies.size,
      deals: deals.size,
      engagements: engagements.size,
      associations: associations.size,
    }
  }
}

// =============================================================================
// Export Default
// =============================================================================

export default HubSpotCRM
