/**
 * @dotdo/hubspot - HubSpot API Type Definitions
 *
 * Type definitions for HubSpot API compatibility layer.
 * Based on @hubspot/api-client SDK patterns.
 *
 * @module @dotdo/hubspot/types
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Standard properties object for HubSpot objects
 */
export type Properties = Record<string, string | null>

/**
 * Paging information for list responses
 */
export interface Paging {
  next?: {
    after: string
    link?: string
  }
}

/**
 * Collection response for paginated resources
 */
export interface CollectionResponse<T> {
  results: T[]
  paging?: Paging | null
}

/**
 * Search result response
 */
export interface SearchResult<T> {
  total: number
  results: T[]
  paging?: Paging | null
}

/**
 * Batch response with status
 */
export interface BatchResult<T> {
  status: 'COMPLETE' | 'PENDING' | 'PROCESSING' | 'CANCELED'
  results: T[]
  errors: BatchError[]
  requestedAt?: string
  startedAt?: string
  completedAt?: string
  numErrors?: number
}

/**
 * Batch error detail
 */
export interface BatchError {
  status: string
  category: string
  subCategory?: string
  message: string
  correlationId: string
  context?: Record<string, string[]>
  links?: Record<string, string>
}

// =============================================================================
// Base Object Type
// =============================================================================

/**
 * Base HubSpot CRM object
 */
export interface CrmObject {
  id: string
  properties: Properties
  createdAt: string
  updatedAt: string
  archived: boolean
  archivedAt?: string
  associations?: Record<string, AssociationResult>
}

// =============================================================================
// Contact Types
// =============================================================================

/**
 * HubSpot Contact object
 */
export interface Contact extends CrmObject {
  properties: {
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
}

/**
 * Contact create input
 */
export interface ContactCreateInput {
  properties: Record<string, string>
  associations?: AssociationInput[]
}

/**
 * Contact update input
 */
export interface ContactUpdateInput {
  properties: Record<string, string>
}

// =============================================================================
// Company Types
// =============================================================================

/**
 * HubSpot Company object
 */
export interface Company extends CrmObject {
  properties: {
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
}

/**
 * Company create input
 */
export interface CompanyCreateInput {
  properties: Record<string, string>
  associations?: AssociationInput[]
}

/**
 * Company update input
 */
export interface CompanyUpdateInput {
  properties: Record<string, string>
}

// =============================================================================
// Deal Types
// =============================================================================

/**
 * HubSpot Deal object
 */
export interface Deal extends CrmObject {
  properties: {
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
}

/**
 * Deal create input
 */
export interface DealCreateInput {
  properties: Record<string, string>
  associations?: AssociationInput[]
}

/**
 * Deal update input
 */
export interface DealUpdateInput {
  properties: Record<string, string>
}

// =============================================================================
// Ticket Types
// =============================================================================

/**
 * HubSpot Ticket object
 */
export interface Ticket extends CrmObject {
  properties: {
    subject?: string | null
    content?: string | null
    hs_pipeline?: string | null
    hs_pipeline_stage?: string | null
    hs_ticket_priority?: string | null
    hubspot_owner_id?: string | null
    createdate?: string | null
    lastmodifieddate?: string | null
    hs_object_id?: string | null
    [key: string]: string | null | undefined
  }
}

// =============================================================================
// Line Item Types
// =============================================================================

/**
 * HubSpot Line Item object (products added to deals)
 */
export interface LineItem extends CrmObject {
  properties: {
    name?: string | null
    hs_product_id?: string | null
    quantity?: string | null
    price?: string | null
    amount?: string | null
    discount?: string | null
    hs_discount_percentage?: string | null
    tax?: string | null
    hs_recurring_billing_period?: string | null
    hs_recurring_billing_start_date?: string | null
    hs_recurring_billing_end_date?: string | null
    hs_term_in_months?: string | null
    description?: string | null
    hs_sku?: string | null
    hs_url?: string | null
    hs_images?: string | null
    hs_cost_of_goods_sold?: string | null
    createdate?: string | null
    lastmodifieddate?: string | null
    hs_object_id?: string | null
    [key: string]: string | null | undefined
  }
}

/**
 * Line item create input
 */
export interface LineItemCreateInput {
  properties: Record<string, string>
  associations?: AssociationInput[]
}

/**
 * Line item update input
 */
export interface LineItemUpdateInput {
  properties: Record<string, string>
}

// =============================================================================
// Product Types
// =============================================================================

/**
 * HubSpot Product object (product catalog)
 */
export interface Product extends CrmObject {
  properties: {
    name?: string | null
    description?: string | null
    price?: string | null
    hs_cost_of_goods_sold?: string | null
    hs_recurring_billing_period?: string | null
    hs_sku?: string | null
    hs_url?: string | null
    hs_images?: string | null
    hs_folder_id?: string | null
    tax?: string | null
    createdate?: string | null
    lastmodifieddate?: string | null
    hs_object_id?: string | null
    [key: string]: string | null | undefined
  }
}

/**
 * Product create input
 */
export interface ProductCreateInput {
  properties: Record<string, string>
}

/**
 * Product update input
 */
export interface ProductUpdateInput {
  properties: Record<string, string>
}

// =============================================================================
// Quote Types
// =============================================================================

/**
 * HubSpot Quote object
 */
export interface Quote extends CrmObject {
  properties: {
    hs_title?: string | null
    hs_expiration_date?: string | null
    hs_status?: 'DRAFT' | 'APPROVAL_NOT_NEEDED' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PENDING_SIGNATURE' | 'SIGNED' | 'EXPIRED' | 'VIEWED' | string | null
    hs_quote_amount?: string | null
    hs_currency?: string | null
    hs_payment_enabled?: string | null
    hs_payment_type?: string | null
    hs_sender_firstname?: string | null
    hs_sender_lastname?: string | null
    hs_sender_email?: string | null
    hs_sender_company_name?: string | null
    hs_esign_enabled?: string | null
    hs_template_id?: string | null
    hs_pdf_download_link?: string | null
    hs_public_url_key?: string | null
    hs_quote_number?: string | null
    hs_terms?: string | null
    hs_comments?: string | null
    hubspot_owner_id?: string | null
    createdate?: string | null
    lastmodifieddate?: string | null
    hs_object_id?: string | null
    [key: string]: string | null | undefined
  }
}

/**
 * Quote create input
 */
export interface QuoteCreateInput {
  properties: Record<string, string>
  associations?: AssociationInput[]
}

/**
 * Quote update input
 */
export interface QuoteUpdateInput {
  properties: Record<string, string>
}

// =============================================================================
// Owner Types
// =============================================================================

/**
 * HubSpot Owner (user)
 */
export interface Owner {
  id: string
  email: string
  firstName?: string
  lastName?: string
  userId?: number
  createdAt: string
  updatedAt: string
  archived: boolean
  teams?: OwnerTeam[]
}

/**
 * Owner team assignment
 */
export interface OwnerTeam {
  id: string
  name: string
  primary?: boolean
}

// =============================================================================
// Property Definition Types
// =============================================================================

/**
 * Property type values
 */
export type PropertyType =
  | 'string'
  | 'number'
  | 'date'
  | 'datetime'
  | 'enumeration'
  | 'bool'

/**
 * Property field type values
 */
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
  | 'html'
  | 'calculation_read_time'

/**
 * Property option for enumeration properties
 */
export interface PropertyOption {
  label: string
  value: string
  displayOrder?: number
  hidden?: boolean
  description?: string
}

/**
 * Property modification metadata
 */
export interface PropertyModificationMetadata {
  archivable: boolean
  readOnlyDefinition: boolean
  readOnlyValue: boolean
}

/**
 * HubSpot Property definition
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
  modificationMetadata?: PropertyModificationMetadata
  formField?: boolean
  calculated?: boolean
  externalOptions?: boolean
  archived?: boolean
  showCurrencySymbol?: boolean
  createdAt?: string
  updatedAt?: string
  createdUserId?: string
  updatedUserId?: string
  hubspotDefined?: boolean
}

/**
 * Property create input
 */
export interface PropertyCreateInput {
  name: string
  label: string
  type: PropertyType
  fieldType: PropertyFieldType
  groupName: string
  description?: string
  options?: PropertyOption[]
  displayOrder?: number
  hasUniqueValue?: boolean
  hidden?: boolean
  formField?: boolean
}

/**
 * Property update input
 */
export interface PropertyUpdateInput {
  label?: string
  description?: string
  groupName?: string
  options?: PropertyOption[]
  displayOrder?: number
  hidden?: boolean
  formField?: boolean
}

/**
 * Property group definition
 */
export interface PropertyGroup {
  name: string
  label: string
  displayOrder: number
  archived?: boolean
}

/**
 * Property group create input
 */
export interface PropertyGroupCreateInput {
  name: string
  label: string
  displayOrder?: number
}

// =============================================================================
// Custom Object / Schema Types
// =============================================================================

/**
 * Custom object schema
 */
export interface ObjectSchema {
  id: string
  name: string
  labels: ObjectSchemaLabels
  fullyQualifiedName: string
  primaryDisplayProperty?: string
  secondaryDisplayProperties?: string[]
  searchableProperties?: string[]
  requiredProperties?: string[]
  properties: PropertyDefinition[]
  associatedObjects?: string[]
  metaType?: 'PORTAL_SPECIFIC'
  archived?: boolean
  createdAt?: string
  updatedAt?: string
}

/**
 * Schema labels (singular and plural)
 */
export interface ObjectSchemaLabels {
  singular: string
  plural: string
}

/**
 * Schema create input
 */
export interface ObjectSchemaCreateInput {
  name: string
  labels: ObjectSchemaLabels
  primaryDisplayProperty?: string
  secondaryDisplayProperties?: string[]
  searchableProperties?: string[]
  requiredProperties?: string[]
  properties?: PropertyCreateInput[]
  associatedObjects?: string[]
}

/**
 * Schema update input
 */
export interface ObjectSchemaUpdateInput {
  labels?: ObjectSchemaLabels
  primaryDisplayProperty?: string
  secondaryDisplayProperties?: string[]
  searchableProperties?: string[]
  requiredProperties?: string[]
}

/**
 * Ticket create input
 */
export interface TicketCreateInput {
  properties: Record<string, string>
  associations?: AssociationInput[]
}

/**
 * Ticket update input
 */
export interface TicketUpdateInput {
  properties: Record<string, string>
}

// =============================================================================
// Engagement Types (Notes, Emails, Calls, Meetings)
// =============================================================================

/**
 * Base Engagement object
 */
export interface Engagement extends CrmObject {
  properties: {
    hs_timestamp?: string | null
    hs_engagement_type?: string | null
    hs_body_preview?: string | null
    hubspot_owner_id?: string | null
    createdate?: string | null
    lastmodifieddate?: string | null
    [key: string]: string | null | undefined
  }
}

/**
 * Note engagement
 */
export interface Note extends CrmObject {
  properties: {
    hs_timestamp?: string | null
    hs_note_body?: string | null
    hubspot_owner_id?: string | null
    createdate?: string | null
    lastmodifieddate?: string | null
    [key: string]: string | null | undefined
  }
}

/**
 * Email engagement
 */
export interface Email extends CrmObject {
  properties: {
    hs_timestamp?: string | null
    hs_email_subject?: string | null
    hs_email_text?: string | null
    hs_email_html?: string | null
    hs_email_direction?: 'INBOUND' | 'OUTBOUND' | string | null
    hs_email_status?: string | null
    hubspot_owner_id?: string | null
    createdate?: string | null
    lastmodifieddate?: string | null
    [key: string]: string | null | undefined
  }
}

/**
 * Call engagement
 */
export interface Call extends CrmObject {
  properties: {
    hs_timestamp?: string | null
    hs_call_title?: string | null
    hs_call_body?: string | null
    hs_call_duration?: string | null
    hs_call_direction?: 'INBOUND' | 'OUTBOUND' | string | null
    hs_call_status?: 'BUSY' | 'CALLING_CRM_USER' | 'CANCELED' | 'COMPLETED' | 'CONNECTING' | 'FAILED' | 'IN_PROGRESS' | 'NO_ANSWER' | 'QUEUED' | 'RINGING' | string | null
    hs_call_disposition?: string | null
    hubspot_owner_id?: string | null
    createdate?: string | null
    lastmodifieddate?: string | null
    [key: string]: string | null | undefined
  }
}

/**
 * Meeting engagement
 */
export interface Meeting extends CrmObject {
  properties: {
    hs_timestamp?: string | null
    hs_meeting_title?: string | null
    hs_meeting_body?: string | null
    hs_meeting_start_time?: string | null
    hs_meeting_end_time?: string | null
    hs_meeting_outcome?: 'SCHEDULED' | 'COMPLETED' | 'RESCHEDULED' | 'NO_SHOW' | 'CANCELED' | string | null
    hs_meeting_location?: string | null
    hubspot_owner_id?: string | null
    createdate?: string | null
    lastmodifieddate?: string | null
    [key: string]: string | null | undefined
  }
}

/**
 * Engagement create input
 */
export interface EngagementCreateInput {
  properties: Record<string, string>
  associations?: AssociationInput[]
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
  metadata?: {
    probability?: string
    isClosed?: string
    ticketState?: string
  }
  createdAt?: string
  updatedAt?: string
  archived?: boolean
}

/**
 * Pipeline
 */
export interface Pipeline {
  id: string
  label: string
  displayOrder: number
  stages: PipelineStage[]
  createdAt?: string
  updatedAt?: string
  archived?: boolean
}

// =============================================================================
// Association Types
// =============================================================================

/**
 * Association type specification
 */
export interface AssociationSpec {
  associationCategory: 'HUBSPOT_DEFINED' | 'USER_DEFINED' | 'INTEGRATOR_DEFINED'
  associationTypeId: number
}

/**
 * Association input for creating associations
 */
export interface AssociationInput {
  to: { id: string }
  types: AssociationSpec[]
}

/**
 * Association result from API
 */
export interface AssociationResult {
  results: Array<{
    toObjectId: number
    associationTypes: Array<{
      category: string
      typeId: number
      label?: string
    }>
  }>
  paging?: Paging | null
}

/**
 * Single association response
 */
export interface Association {
  fromObjectTypeId: string
  fromObjectId: number
  toObjectTypeId: string
  toObjectId: number
  labels: string[]
}

/**
 * Batch association input
 */
export interface BatchAssociationInput {
  inputs: Array<{
    from: { id: string }
    to: { id: string }
    types: AssociationSpec[]
  }>
}

/**
 * Batch association result
 */
export interface BatchAssociationResult {
  status: 'COMPLETE' | 'PENDING' | 'PROCESSING' | 'CANCELED'
  results: Array<{
    from: { id: string }
    to: { id: string }
    type: string
  }>
  errors: BatchError[]
}

// =============================================================================
// Search Types
// =============================================================================

/**
 * Filter operator types
 */
export type FilterOperator =
  | 'EQ'
  | 'NEQ'
  | 'LT'
  | 'LTE'
  | 'GT'
  | 'GTE'
  | 'BETWEEN'
  | 'IN'
  | 'NOT_IN'
  | 'HAS_PROPERTY'
  | 'NOT_HAS_PROPERTY'
  | 'CONTAINS_TOKEN'
  | 'NOT_CONTAINS_TOKEN'

/**
 * Single filter
 */
export interface Filter {
  propertyName: string
  operator: FilterOperator
  value?: string
  values?: string[]
  highValue?: string
}

/**
 * Filter group (filters within a group are ANDed)
 */
export interface FilterGroup {
  filters: Filter[]
}

/**
 * Sort option
 */
export interface Sort {
  propertyName: string
  direction: 'ASCENDING' | 'DESCENDING'
}

/**
 * Search request body
 */
export interface SearchRequest {
  filterGroups?: FilterGroup[]
  sorts?: Sort[]
  query?: string
  properties?: string[]
  limit?: number
  after?: string
}

// =============================================================================
// Batch Types
// =============================================================================

/**
 * Batch read input
 */
export interface BatchReadInput {
  inputs: Array<{ id: string }>
  properties?: string[]
  propertiesWithHistory?: string[]
}

/**
 * Batch create input
 */
export interface BatchCreateInput<T> {
  inputs: T[]
}

/**
 * Batch update input
 */
export interface BatchUpdateInput {
  inputs: Array<{
    id: string
    properties: Record<string, string>
  }>
}

/**
 * Batch archive input
 */
export interface BatchArchiveInput {
  inputs: Array<{ id: string }>
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * HubSpot error detail
 */
export interface HubSpotErrorDetail {
  status: string
  category: string
  subCategory?: string
  message: string
  correlationId: string
  context?: Record<string, string[]>
  links?: Record<string, string>
  errors?: Array<{
    message: string
    in?: string
    code?: string
    subCategory?: string
    context?: Record<string, string[]>
  }>
}

// =============================================================================
// Client Configuration Types
// =============================================================================

/**
 * Mock fetch function type for testing
 */
export type FetchFunction = (url: string, init?: RequestInit) => Promise<{
  ok: boolean
  status: number
  headers: Headers
  json: () => Promise<unknown>
}>

/**
 * Client configuration options
 */
export interface ClientConfig {
  accessToken: string
  basePath?: string
  defaultHeaders?: Record<string, string>
  fetch?: typeof fetch | FetchFunction
}

/**
 * Request options for API calls
 */
export interface RequestOptions {
  headers?: Record<string, string>
}

// =============================================================================
// Forms Types
// =============================================================================

/**
 * Form type
 */
export type FormType = 'hubspot' | 'embedded' | 'standalone' | 'popup' | 'banner'

/**
 * Form state
 */
export type FormState = 'draft' | 'published' | 'archived'

/**
 * Field type options
 */
export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'booleancheckbox'
  | 'number'
  | 'file'
  | 'date'
  | 'phonenumber'
  | 'email'

/**
 * Form field definition
 */
export interface FormField {
  name: string
  label: string
  fieldType: FormFieldType
  description?: string
  placeholder?: string
  defaultValue?: string
  required: boolean
  hidden: boolean
  validation?: FormFieldValidation
  dependentFieldFilters?: FormDependentFieldFilter[]
  options?: FormFieldOption[]
  objectTypeId?: string
  propertyName?: string
}

/**
 * Field validation rules
 */
export interface FormFieldValidation {
  name: string
  message?: string
  blocksFormSubmission: boolean
  data?: string
  useDefaultBlockList?: boolean
  minAllowedValue?: number
  maxAllowedValue?: number
  minLength?: number
  maxLength?: number
  regex?: string
}

/**
 * Dependent field filter
 */
export interface FormDependentFieldFilter {
  dependentFieldName: string
  dependentOperator: 'SET_ANY' | 'NOT_SET' | 'EQUAL' | 'NOT_EQUAL'
  dependentFieldValues?: string[]
}

/**
 * Field option for select/radio/checkbox
 */
export interface FormFieldOption {
  label: string
  value: string
  displayOrder: number
  hidden?: boolean
  description?: string
}

/**
 * Field group within a form
 */
export interface FormFieldGroup {
  groupType: 'default_group' | 'progressive' | 'dependent'
  richTextType?: 'TEXT' | 'HTML'
  richText?: string
  fields: FormField[]
}

/**
 * Form styling configuration
 */
export interface FormStyle {
  fontFamily?: string
  labelTextColor?: string
  helpTextColor?: string
  legalConsentTextColor?: string
  submitColor?: string
  submitFontColor?: string
  submitAlignment?: 'left' | 'center' | 'right'
  backgroundWidth?: 'content' | 'form'
  backgroundColor?: string
}

/**
 * Legal consent options
 */
export interface FormLegalConsentOptions {
  type: 'implicit' | 'legitimate_interest' | 'explicit'
  subscriptionTypeIds?: number[]
  lawfulBasis?: string
  privacyText?: string
  communicationConsentText?: string
  processingConsentText?: string
  processingConsentCheckboxLabel?: string
  communicationConsentCheckboxes?: Array<{
    subscriptionTypeId: number
    label: string
    required: boolean
  }>
}

/**
 * Form configuration
 */
export interface FormConfiguration {
  language?: string
  cloneable?: boolean
  postSubmitAction?: {
    type: 'redirect_url' | 'inline_message' | 'schedule_meeting'
    value?: string
    meetingLink?: string
  }
  editable?: boolean
  archivable?: boolean
  recaptchaEnabled?: boolean
  notifyRecipients?: string[]
  notifyOwner?: boolean
  createNewContactForNewEmail?: boolean
  prePopulateKnownValues?: boolean
  allowLinkToResetKnownValues?: boolean
  lifecycleStage?: string
}

/**
 * Form definition
 */
export interface Form {
  id: string
  name: string
  formType: FormType
  state: FormState
  fieldGroups: FormFieldGroup[]
  submitButtonText: string
  style?: FormStyle
  legalConsentOptions?: FormLegalConsentOptions
  configuration: FormConfiguration
  displayOptions?: {
    cssClass?: string
    submitButtonClass?: string
    renderRawHtml?: boolean
  }
  redirectUrl?: string
  inlineMessage?: string
  thankYouMessageJson?: string
  portalId?: number
  guid?: string
  version?: number
  createdAt: string
  updatedAt: string
  archived: boolean
  archivedAt?: string
}

/**
 * Form submission field
 */
export interface FormSubmissionField {
  name: string
  value: string
  objectTypeId?: string
}

/**
 * Submission context
 */
export interface FormSubmissionContext {
  hutk?: string
  pageUri?: string
  pageName?: string
  pageId?: string
  ipAddress?: string
  timestamp?: string
  sfdcCampaignId?: string
  goToWebinarWebinarKey?: string
}

/**
 * Legal consent in submission
 */
export interface FormSubmissionLegalConsent {
  legitimateInterest?: {
    subscriptionTypeId: number
    value: boolean
    legalBasis: string
    text: string
  }
  consent?: {
    consentToProcess: boolean
    text: string
    communications?: Array<{
      subscriptionTypeId: number
      value: boolean
      text: string
    }>
  }
}

/**
 * Form submission input
 */
export interface FormSubmissionInput {
  fields: FormSubmissionField[]
  context?: FormSubmissionContext
  legalConsentOptions?: FormSubmissionLegalConsent
  skipValidation?: boolean
}

/**
 * Form submission result
 */
export interface FormSubmission {
  id: string
  formId: string
  submittedAt: string
  values: Record<string, string>
  pageUrl?: string
  pageName?: string
  ipAddress?: string
  contactId?: string
  conversionId?: string
}

/**
 * Submission result
 */
export interface FormSubmissionResult {
  redirectUri?: string
  inlineMessage?: string
  errors?: FormValidationError[]
}

/**
 * Form validation error
 */
export interface FormValidationError {
  errorType: string
  message: string
  fieldName?: string
}

/**
 * Form create input
 */
export interface CreateFormInput {
  name: string
  formType?: FormType
  fieldGroups: FormFieldGroup[]
  submitButtonText?: string
  style?: FormStyle
  legalConsentOptions?: FormLegalConsentOptions
  configuration?: Partial<FormConfiguration>
  displayOptions?: Form['displayOptions']
  redirectUrl?: string
  inlineMessage?: string
}

/**
 * Form update input
 */
export interface UpdateFormInput {
  name?: string
  fieldGroups?: FormFieldGroup[]
  submitButtonText?: string
  style?: FormStyle
  legalConsentOptions?: FormLegalConsentOptions
  configuration?: Partial<FormConfiguration>
  displayOptions?: Form['displayOptions']
  redirectUrl?: string
  inlineMessage?: string
}

/**
 * List forms options
 */
export interface ListFormsOptions {
  limit?: number
  after?: string
  formTypes?: FormType[]
  state?: FormState
}

/**
 * Form list result
 */
export interface FormListResult<T> {
  results: T[]
  paging?: {
    next?: { after: string }
  }
}

/**
 * Form batch result
 */
export interface FormBatchResult<T> {
  status: 'COMPLETE' | 'PENDING' | 'PROCESSING'
  results: T[]
  errors: Array<{ status: string; message: string; context?: Record<string, unknown> }>
}

/**
 * Forms storage interface
 */
export interface FormsStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: { prefix?: string; limit?: number }): Promise<Map<string, unknown>>
}

/**
 * Form statistics
 */
export interface FormStats {
  totalSubmissions: number
  submissionsLast24h: number
  submissionsLast7d: number
  submissionsLast30d: number
}
