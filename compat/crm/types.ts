/**
 * @dotdo/crm - Unified CRM Abstractions
 *
 * Common interfaces for CRM compatibility layers (Salesforce, HubSpot, Pipedrive, Close).
 * Provides a unified API for contacts, companies, deals, pipelines, and activities.
 *
 * @module @dotdo/crm
 */

// =============================================================================
// Base Entity Types
// =============================================================================

/**
 * Base CRM entity with common fields
 */
export interface CRMEntity {
  id: string
  createdAt: string
  updatedAt: string
  archived?: boolean
  customFields?: Record<string, unknown>
}

// =============================================================================
// Contact/Lead Types
// =============================================================================

/**
 * Unified contact interface across CRM platforms
 *
 * Maps to:
 * - Salesforce: Contact/Lead
 * - HubSpot: Contact
 * - Pipedrive: Person
 * - Close: Lead/Contact
 */
export interface Contact extends CRMEntity {
  email?: string
  firstName?: string
  lastName?: string
  phone?: string
  mobilePhone?: string
  title?: string
  department?: string
  companyId?: string
  companyName?: string
  address?: Address
  lifecycleStage?: LifecycleStage
  leadStatus?: string
  leadSource?: string
  ownerId?: string
  tags?: string[]
}

export interface ContactCreateInput {
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  mobilePhone?: string
  title?: string
  department?: string
  companyId?: string
  companyName?: string
  address?: Partial<Address>
  lifecycleStage?: LifecycleStage
  leadStatus?: string
  leadSource?: string
  ownerId?: string
  tags?: string[]
  customFields?: Record<string, unknown>
}

export interface ContactUpdateInput {
  email?: string
  firstName?: string
  lastName?: string
  phone?: string
  mobilePhone?: string
  title?: string
  department?: string
  companyId?: string
  companyName?: string
  address?: Partial<Address>
  lifecycleStage?: LifecycleStage
  leadStatus?: string
  leadSource?: string
  ownerId?: string
  tags?: string[]
  customFields?: Record<string, unknown>
}

export type LifecycleStage =
  | 'subscriber'
  | 'lead'
  | 'marketing_qualified_lead'
  | 'sales_qualified_lead'
  | 'opportunity'
  | 'customer'
  | 'evangelist'
  | 'other'

// =============================================================================
// Company/Account Types
// =============================================================================

/**
 * Unified company interface across CRM platforms
 *
 * Maps to:
 * - Salesforce: Account
 * - HubSpot: Company
 * - Pipedrive: Organization
 * - Close: Lead (company-level)
 */
export interface Company extends CRMEntity {
  name: string
  domain?: string
  website?: string
  industry?: string
  description?: string
  phone?: string
  address?: Address
  employeeCount?: number
  annualRevenue?: number
  type?: CompanyType
  ownerId?: string
  tags?: string[]
}

export interface CompanyCreateInput {
  name: string
  domain?: string
  website?: string
  industry?: string
  description?: string
  phone?: string
  address?: Partial<Address>
  employeeCount?: number
  annualRevenue?: number
  type?: CompanyType
  ownerId?: string
  tags?: string[]
  customFields?: Record<string, unknown>
}

export interface CompanyUpdateInput {
  name?: string
  domain?: string
  website?: string
  industry?: string
  description?: string
  phone?: string
  address?: Partial<Address>
  employeeCount?: number
  annualRevenue?: number
  type?: CompanyType
  ownerId?: string
  tags?: string[]
  customFields?: Record<string, unknown>
}

export type CompanyType =
  | 'prospect'
  | 'customer'
  | 'partner'
  | 'vendor'
  | 'competitor'
  | 'other'

// =============================================================================
// Deal/Opportunity Types
// =============================================================================

/**
 * Unified deal interface across CRM platforms
 *
 * Maps to:
 * - Salesforce: Opportunity
 * - HubSpot: Deal
 * - Pipedrive: Deal
 * - Close: Opportunity
 */
export interface Deal extends CRMEntity {
  name: string
  amount?: number
  currency?: string
  stage: string
  stageId?: string
  pipelineId?: string
  pipelineName?: string
  probability?: number
  expectedCloseDate?: string
  actualCloseDate?: string
  status: DealStatus
  lostReason?: string
  wonReason?: string
  companyId?: string
  contactIds?: string[]
  ownerId?: string
  tags?: string[]
}

export interface DealCreateInput {
  name: string
  amount?: number
  currency?: string
  stage: string
  stageId?: string
  pipelineId?: string
  probability?: number
  expectedCloseDate?: string
  companyId?: string
  contactIds?: string[]
  ownerId?: string
  tags?: string[]
  customFields?: Record<string, unknown>
}

export interface DealUpdateInput {
  name?: string
  amount?: number
  currency?: string
  stage?: string
  stageId?: string
  pipelineId?: string
  probability?: number
  expectedCloseDate?: string
  actualCloseDate?: string
  status?: DealStatus
  lostReason?: string
  wonReason?: string
  companyId?: string
  contactIds?: string[]
  ownerId?: string
  tags?: string[]
  customFields?: Record<string, unknown>
}

export type DealStatus = 'open' | 'won' | 'lost'

// =============================================================================
// Pipeline Types
// =============================================================================

/**
 * Sales pipeline definition
 */
export interface Pipeline extends CRMEntity {
  name: string
  stages: PipelineStage[]
  isDefault?: boolean
  orderIndex?: number
}

export interface PipelineStage {
  id: string
  name: string
  orderIndex: number
  probability?: number
  rottenDays?: number
  isWon?: boolean
  isLost?: boolean
}

export interface PipelineCreateInput {
  name: string
  stages: Omit<PipelineStage, 'id'>[]
  isDefault?: boolean
}

// =============================================================================
// Activity Types
// =============================================================================

/**
 * Unified activity interface for CRM activities/engagements
 *
 * Maps to:
 * - Salesforce: Task/Event/Activity
 * - HubSpot: Engagement
 * - Pipedrive: Activity
 * - Close: Activity
 */
export interface Activity extends CRMEntity {
  type: ActivityType
  subject: string
  body?: string
  status?: ActivityStatus
  dueDate?: string
  completedDate?: string
  duration?: number // in minutes
  contactIds?: string[]
  companyId?: string
  dealId?: string
  ownerId?: string
  priority?: ActivityPriority
}

export interface ActivityCreateInput {
  type: ActivityType
  subject: string
  body?: string
  status?: ActivityStatus
  dueDate?: string
  duration?: number
  contactIds?: string[]
  companyId?: string
  dealId?: string
  ownerId?: string
  priority?: ActivityPriority
  customFields?: Record<string, unknown>
}

export interface ActivityUpdateInput {
  subject?: string
  body?: string
  status?: ActivityStatus
  dueDate?: string
  completedDate?: string
  duration?: number
  contactIds?: string[]
  companyId?: string
  dealId?: string
  ownerId?: string
  priority?: ActivityPriority
  customFields?: Record<string, unknown>
}

export type ActivityType =
  | 'call'
  | 'email'
  | 'meeting'
  | 'task'
  | 'note'
  | 'sms'
  | 'deadline'
  | 'lunch'

export type ActivityStatus =
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'canceled'
  | 'deferred'

export type ActivityPriority = 'low' | 'medium' | 'high' | 'urgent'

// =============================================================================
// Note Types
// =============================================================================

/**
 * Simple note attached to CRM entities
 */
export interface Note extends CRMEntity {
  content: string
  contactId?: string
  companyId?: string
  dealId?: string
  ownerId?: string
}

export interface NoteCreateInput {
  content: string
  contactId?: string
  companyId?: string
  dealId?: string
  ownerId?: string
}

// =============================================================================
// Common Types
// =============================================================================

export interface Address {
  street?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
}

export interface Owner {
  id: string
  name: string
  email: string
}

// =============================================================================
// Search & Filter Types
// =============================================================================

export interface SearchFilter {
  field: string
  operator: FilterOperator
  value?: unknown
  values?: unknown[]
}

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'in'
  | 'not_in'
  | 'is_empty'
  | 'is_not_empty'

export interface SearchOptions {
  filters?: SearchFilter[]
  sorts?: Array<{ field: string; direction: 'asc' | 'desc' }>
  limit?: number
  offset?: number
  cursor?: string
}

export interface SearchResult<T> {
  total: number
  results: T[]
  hasMore: boolean
  nextCursor?: string
}

export interface ListResult<T> {
  results: T[]
  hasMore: boolean
  nextCursor?: string
}

// =============================================================================
// Batch Operation Types
// =============================================================================

export interface BatchResult<T> {
  succeeded: T[]
  failed: Array<{
    input: unknown
    error: string
  }>
}

// =============================================================================
// CRM Client Interface
// =============================================================================

/**
 * Unified CRM client interface that all compat layers implement
 */
export interface CRMClient {
  // Contacts
  contacts: {
    create(input: ContactCreateInput): Promise<Contact>
    get(id: string): Promise<Contact | null>
    update(id: string, input: ContactUpdateInput): Promise<Contact>
    delete(id: string): Promise<void>
    search(query: string, options?: SearchOptions): Promise<SearchResult<Contact>>
    list(options?: SearchOptions): Promise<ListResult<Contact>>
  }

  // Companies
  companies: {
    create(input: CompanyCreateInput): Promise<Company>
    get(id: string): Promise<Company | null>
    update(id: string, input: CompanyUpdateInput): Promise<Company>
    delete(id: string): Promise<void>
    search(query: string, options?: SearchOptions): Promise<SearchResult<Company>>
    list(options?: SearchOptions): Promise<ListResult<Company>>
  }

  // Deals
  deals: {
    create(input: DealCreateInput): Promise<Deal>
    get(id: string): Promise<Deal | null>
    update(id: string, input: DealUpdateInput): Promise<Deal>
    delete(id: string): Promise<void>
    search(query: string, options?: SearchOptions): Promise<SearchResult<Deal>>
    list(options?: SearchOptions): Promise<ListResult<Deal>>
    moveToStage(dealId: string, stageId: string): Promise<Deal>
  }

  // Pipelines
  pipelines: {
    create(input: PipelineCreateInput): Promise<Pipeline>
    get(id: string): Promise<Pipeline | null>
    list(): Promise<ListResult<Pipeline>>
    getDefault(): Promise<Pipeline | null>
  }

  // Activities
  activities: {
    create(input: ActivityCreateInput): Promise<Activity>
    get(id: string): Promise<Activity | null>
    update(id: string, input: ActivityUpdateInput): Promise<Activity>
    delete(id: string): Promise<void>
    list(options?: SearchOptions): Promise<ListResult<Activity>>
    listForContact(contactId: string): Promise<ListResult<Activity>>
    listForDeal(dealId: string): Promise<ListResult<Activity>>
    complete(id: string): Promise<Activity>
  }

  // Notes
  notes: {
    create(input: NoteCreateInput): Promise<Note>
    get(id: string): Promise<Note | null>
    delete(id: string): Promise<void>
    listForContact(contactId: string): Promise<ListResult<Note>>
    listForDeal(dealId: string): Promise<ListResult<Note>>
  }

  // Associations
  associations: {
    associateContactToCompany(contactId: string, companyId: string): Promise<void>
    associateContactToDeal(contactId: string, dealId: string): Promise<void>
    associateDealToCompany(dealId: string, companyId: string): Promise<void>
    disassociateContactFromCompany(contactId: string, companyId: string): Promise<void>
    disassociateContactFromDeal(contactId: string, dealId: string): Promise<void>
    disassociateDealFromCompany(dealId: string, companyId: string): Promise<void>
  }
}

// =============================================================================
// Error Types
// =============================================================================

export class CRMError extends Error {
  code: string
  statusCode: number
  details?: Record<string, unknown>

  constructor(
    message: string,
    code: string,
    statusCode: number = 400,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'CRMError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }
}

// Common error codes
export const CRMErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE: 'DUPLICATE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const
