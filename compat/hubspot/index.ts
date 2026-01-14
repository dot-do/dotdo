/**
 * @dotdo/hubspot - HubSpot SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for @hubspot/api-client backed by Durable Objects with
 * edge-native performance.
 *
 * Features:
 * - API-compatible with `@hubspot/api-client` npm package
 * - Contacts management (create, get, update, delete, search, batch)
 * - Companies management (create, get, update, delete, search)
 * - Deals with pipeline stages
 * - Tickets management
 * - Line Items (products on deals)
 * - Products (product catalog)
 * - Quotes (sales quotes)
 * - Associations between objects (v4 API)
 * - Engagements (notes, emails, calls, meetings)
 * - Owners API (HubSpot users)
 * - Properties API (custom property management)
 * - Schemas API (custom object definitions)
 *
 * @example Basic Usage
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
 *     phone: '+1234567890',
 *   },
 * })
 * ```
 *
 * @example Search Contacts
 * ```typescript
 * import { Client } from '@dotdo/hubspot'
 *
 * const hubspot = new Client({ accessToken: 'pat-xxx' })
 *
 * const contacts = await hubspot.crm.contacts.searchApi.doSearch({
 *   filterGroups: [{
 *     filters: [
 *       { propertyName: 'email', operator: 'CONTAINS_TOKEN', value: '@example.com' },
 *     ],
 *   }],
 * })
 * ```
 *
 * @example Create Company and Deal
 * ```typescript
 * import { Client } from '@dotdo/hubspot'
 *
 * const hubspot = new Client({ accessToken: 'pat-xxx' })
 *
 * // Create company
 * const company = await hubspot.crm.companies.basicApi.create({
 *   properties: {
 *     name: 'Acme Inc',
 *     domain: 'acme.com',
 *     industry: 'Technology',
 *   },
 * })
 *
 * // Create deal
 * const deal = await hubspot.crm.deals.basicApi.create({
 *   properties: {
 *     dealname: 'New Deal',
 *     amount: '10000',
 *     dealstage: 'appointmentscheduled',
 *     pipeline: 'default',
 *   },
 * })
 * ```
 *
 * @example Associations
 * ```typescript
 * import { Client } from '@dotdo/hubspot'
 *
 * const hubspot = new Client({ accessToken: 'pat-xxx' })
 *
 * // Associate contact with company
 * await hubspot.crm.associations.v4.basicApi.create(
 *   'contacts',
 *   contactId,
 *   'companies',
 *   companyId,
 *   [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }]
 * )
 * ```
 *
 * @example Batch Operations
 * ```typescript
 * import { Client } from '@dotdo/hubspot'
 *
 * const hubspot = new Client({ accessToken: 'pat-xxx' })
 *
 * const result = await hubspot.crm.contacts.batchApi.create({
 *   inputs: [
 *     { properties: { email: 'user1@example.com', firstname: 'User', lastname: 'One' } },
 *     { properties: { email: 'user2@example.com', firstname: 'User', lastname: 'Two' } },
 *   ],
 * })
 * ```
 *
 * @see https://developers.hubspot.com/docs/api/crm
 */

// Re-export main client
export { Client, HubSpotError } from './hubspot'

export { default } from './hubspot'

// Re-export CRM module
export { HubSpotCRM, HubSpotCRMError } from './crm'

// Re-export Workflows module
export {
  HubSpotWorkflows,
  HubSpotWorkflowError,
  WorkflowTemplates,
  SuppressionListManager,
  type Workflow,
  type WorkflowType,
  type WorkflowStatus,
  type WorkflowAction,
  type WorkflowActionType,
  type WorkflowActionConfig,
  type EnrollmentTrigger,
  type EnrollmentTriggerType,
  type EnrollmentTriggerConfig,
  type Enrollment,
  type EnrollmentStatus,
  type EnrollmentEvent,
  type WorkflowStats,
  type EnrollmentStats,
  type ActionPerformance,
  type CreateWorkflowInput,
  type UpdateWorkflowInput,
  type BranchCondition,
  type ConditionOperator,
  type DelayType,
  type BusinessHours,
  type ReenrollmentSettings,
  type GoalCriteria,
  type WorkflowSettings,
  type WorkflowStorage,
  type WorkflowTemplateType,
  type WorkflowTemplateConfig,
  type SuppressionList,
} from './workflows'

// Re-export Forms module
export {
  HubSpotForms,
  HubSpotFormsError,
  type Form,
  type FormType,
  type FormState,
  type FormField,
  type FieldType,
  type FieldGroup,
  type FormSubmission,
  type FormSubmissionInput,
  type SubmissionResult,
  type CreateFormInput,
  type UpdateFormInput,
  type ListFormsOptions,
  type FormsStorage,
} from './forms'

// Re-export Webhooks module
export {
  HubSpotWebhooks,
  HubSpotWebhookError,
  type WebhookEventType,
  type WebhookObjectType,
  type WebhookSubscription,
  type WebhookEvent,
  type WebhookDelivery,
  type CreateSubscriptionInput,
  type UpdateSubscriptionInput,
  type TriggerEventInput,
  type WebhookSettings,
  type WebhookConfig,
  type WebhookStorage,
} from './webhooks'

// Re-export Local module
export {
  HubSpotLocal,
  InMemoryStorage,
} from './local'

// Re-export types
export type {
  // Core types
  Properties,
  Paging,
  CollectionResponse,
  SearchResult,
  BatchResult,
  BatchError,
  CrmObject,

  // Contact types
  Contact,
  ContactCreateInput,
  ContactUpdateInput,

  // Company types
  Company,
  CompanyCreateInput,
  CompanyUpdateInput,

  // Deal types
  Deal,
  DealCreateInput,
  DealUpdateInput,

  // Ticket types
  Ticket,
  TicketCreateInput,
  TicketUpdateInput,

  // Line Item types
  LineItem,
  LineItemCreateInput,
  LineItemUpdateInput,

  // Product types
  Product,
  ProductCreateInput,
  ProductUpdateInput,

  // Quote types
  Quote,
  QuoteCreateInput,
  QuoteUpdateInput,

  // Owner types
  Owner,
  OwnerTeam,

  // Property types
  PropertyType,
  PropertyFieldType,
  PropertyOption,
  PropertyModificationMetadata,
  PropertyDefinition,
  PropertyCreateInput,
  PropertyUpdateInput,
  PropertyGroup,
  PropertyGroupCreateInput,

  // Schema types (Custom Objects)
  ObjectSchema,
  ObjectSchemaLabels,
  ObjectSchemaCreateInput,
  ObjectSchemaUpdateInput,

  // Engagement types
  Engagement,
  Note,
  Email,
  Call,
  Meeting,
  EngagementCreateInput,

  // Pipeline types
  Pipeline,
  PipelineStage,

  // Association types
  AssociationSpec,
  AssociationInput,
  AssociationResult,
  Association,
  BatchAssociationInput,
  BatchAssociationResult,

  // Search types
  FilterOperator,
  Filter,
  FilterGroup,
  Sort,
  SearchRequest,

  // Batch types
  BatchReadInput,
  BatchCreateInput,
  BatchUpdateInput,
  BatchArchiveInput,

  // Error types
  HubSpotErrorDetail,

  // Client types
  ClientConfig,
  FetchFunction,
  RequestOptions,
} from './types'
