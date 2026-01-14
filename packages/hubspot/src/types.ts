/**
 * @dotdo/hubspot - Type Definitions
 *
 * HubSpot API types following @hubspot/api-client interface patterns.
 */

// =============================================================================
// Base Types
// =============================================================================

/**
 * Base CRM object structure
 */
export interface CRMObject {
  id: string
  properties: Record<string, string>
  createdAt: string
  updatedAt: string
  archived: boolean
  archivedAt?: string
}

/**
 * Contact object
 */
export interface Contact extends CRMObject {
  properties: {
    email?: string
    firstname?: string
    lastname?: string
    phone?: string
    company?: string
    website?: string
    lifecyclestage?: string
    createdate?: string
    lastmodifieddate?: string
    hs_object_id?: string
    [key: string]: string | undefined
  }
}

/**
 * Company object
 */
export interface Company extends CRMObject {
  properties: {
    name?: string
    domain?: string
    industry?: string
    phone?: string
    city?: string
    state?: string
    country?: string
    numberofemployees?: string
    annualrevenue?: string
    createdate?: string
    lastmodifieddate?: string
    hs_object_id?: string
    [key: string]: string | undefined
  }
}

/**
 * Deal object
 */
export interface Deal extends CRMObject {
  properties: {
    dealname?: string
    amount?: string
    dealstage?: string
    pipeline?: string
    closedate?: string
    createdate?: string
    lastmodifieddate?: string
    hs_object_id?: string
    hubspot_owner_id?: string
    [key: string]: string | undefined
  }
}

/**
 * Ticket object
 */
export interface Ticket extends CRMObject {
  properties: {
    subject?: string
    content?: string
    hs_pipeline?: string
    hs_pipeline_stage?: string
    hs_ticket_priority?: string
    hs_ticket_category?: string
    createdate?: string
    lastmodifieddate?: string
    hs_object_id?: string
    [key: string]: string | undefined
  }
}

/**
 * Engagement object (notes, emails, calls, meetings)
 */
export interface Engagement extends CRMObject {
  properties: {
    hs_timestamp?: string
    hs_engagement_type?: string
    hs_body_preview?: string
    hs_note_body?: string
    hs_email_subject?: string
    hs_email_text?: string
    hs_email_direction?: string
    hs_call_title?: string
    hs_call_body?: string
    hs_call_duration?: string
    hs_call_direction?: string
    hs_call_status?: string
    hs_meeting_title?: string
    hs_meeting_body?: string
    hs_meeting_start_time?: string
    hs_meeting_end_time?: string
    hs_meeting_outcome?: string
    createdate?: string
    lastmodifieddate?: string
    [key: string]: string | undefined
  }
}

/**
 * Line Item object
 */
export interface LineItem extends CRMObject {
  properties: {
    name?: string
    hs_product_id?: string
    quantity?: string
    price?: string
    amount?: string
    createdate?: string
    lastmodifieddate?: string
    hs_object_id?: string
    [key: string]: string | undefined
  }
}

/**
 * Product object
 */
export interface Product extends CRMObject {
  properties: {
    name?: string
    description?: string
    price?: string
    hs_recurring_billing_period?: string
    createdate?: string
    lastmodifieddate?: string
    hs_object_id?: string
    [key: string]: string | undefined
  }
}

/**
 * Quote object
 */
export interface Quote extends CRMObject {
  properties: {
    hs_title?: string
    hs_expiration_date?: string
    hs_status?: string
    hs_quote_amount?: string
    hs_currency?: string
    createdate?: string
    lastmodifieddate?: string
    hs_object_id?: string
    [key: string]: string | undefined
  }
}

/**
 * Owner object
 */
export interface Owner {
  id: string
  email: string
  firstName: string
  lastName: string
  userId?: number
  createdAt: string
  updatedAt: string
  archived: boolean
  teams?: Array<{ id: string; name: string; primary: boolean }>
}

// =============================================================================
// Association Types
// =============================================================================

/**
 * Association between objects
 */
export interface Association {
  fromObjectTypeId: string
  fromObjectId: number
  toObjectTypeId: string
  toObjectId: number
  labels: string[]
}

/**
 * Association type definition
 */
export interface AssociationType {
  associationCategory: 'HUBSPOT_DEFINED' | 'USER_DEFINED' | 'INTEGRATOR_DEFINED'
  associationTypeId: number
}

/**
 * Association result from getPage
 */
export interface AssociationResult {
  toObjectId: number
  associationTypes: Array<{
    category: string
    typeId: number
    label?: string
  }>
}

// =============================================================================
// Pipeline Types
// =============================================================================

/**
 * Pipeline stage
 */
export interface PipelineStage {
  id: string
  label: string
  displayOrder: number
  metadata?: Record<string, unknown>
}

/**
 * Pipeline
 */
export interface Pipeline {
  id: string
  label: string
  displayOrder: number
  stages: PipelineStage[]
}

// =============================================================================
// Property Types
// =============================================================================

/**
 * Property definition
 */
export interface Property {
  name: string
  label: string
  type: string
  fieldType: string
  groupName: string
  description?: string
  hasUniqueValue?: boolean
  hidden?: boolean
  hubspotDefined?: boolean
  options?: PropertyOption[]
  createdAt?: string
  updatedAt?: string
}

/**
 * Property option (for enumeration types)
 */
export interface PropertyOption {
  label: string
  value: string
  displayOrder: number
  hidden?: boolean
}

/**
 * Property group
 */
export interface PropertyGroup {
  name: string
  label: string
  displayOrder: number
}

// =============================================================================
// Schema Types (Custom Objects)
// =============================================================================

/**
 * Custom object schema
 */
export interface Schema {
  id: string
  name: string
  labels: {
    singular: string
    plural: string
  }
  fullyQualifiedName: string
  primaryDisplayProperty: string
  properties: Property[]
  associatedObjects?: string[]
  createdAt: string
  updatedAt: string
  archived?: boolean
}

// =============================================================================
// Search Types
// =============================================================================

/**
 * Search filter
 */
export interface SearchFilter {
  propertyName: string
  operator: 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE' | 'HAS_PROPERTY' | 'NOT_HAS_PROPERTY' | 'CONTAINS_TOKEN' | 'NOT_CONTAINS_TOKEN' | 'IN' | 'NOT_IN' | 'BETWEEN'
  value?: string
  values?: string[]
  highValue?: string
}

/**
 * Search filter group
 */
export interface SearchFilterGroup {
  filters: SearchFilter[]
}

/**
 * Search request
 */
export interface SearchRequest {
  filterGroups: SearchFilterGroup[]
  sorts?: Array<{
    propertyName: string
    direction: 'ASCENDING' | 'DESCENDING'
  }>
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
    next?: {
      after: string
    }
  } | null
}

// =============================================================================
// Batch Types
// =============================================================================

/**
 * Batch input for creating objects
 */
export interface BatchCreateInput<T> {
  inputs: Array<{
    properties: Partial<T extends CRMObject ? T['properties'] : Record<string, string>>
  }>
}

/**
 * Batch input for reading objects
 */
export interface BatchReadInput {
  inputs: Array<{ id: string }>
  properties?: string[]
}

/**
 * Batch input for updating objects
 */
export interface BatchUpdateInput<T> {
  inputs: Array<{
    id: string
    properties: Partial<T extends CRMObject ? T['properties'] : Record<string, string>>
  }>
}

/**
 * Batch input for archiving objects
 */
export interface BatchArchiveInput {
  inputs: Array<{ id: string }>
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
// List Types
// =============================================================================

/**
 * List result
 */
export interface ListResult<T> {
  results: T[]
  paging?: {
    next?: {
      after: string
    }
  }
}

// =============================================================================
// Create/Update Input Types
// =============================================================================

/**
 * Create input
 */
export interface CreateInput<T> {
  properties: Partial<T extends CRMObject ? T['properties'] : Record<string, string>>
  associations?: Array<{
    to: { id: string }
    types: AssociationType[]
  }>
}

/**
 * Update input
 */
export interface UpdateInput<T> {
  properties: Partial<T extends CRMObject ? T['properties'] : Record<string, string>>
}

// =============================================================================
// Client Configuration Types
// =============================================================================

/**
 * Client configuration options
 */
export interface ClientConfig {
  accessToken: string
  basePath?: string
  fetch?: typeof fetch
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * HubSpot API error response
 */
export interface HubSpotErrorResponse {
  status: 'error'
  message: string
  correlationId: string
  category: string
  context?: Record<string, unknown>
}
