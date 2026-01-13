/**
 * @dotdo/zendesk - Zendesk SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for node-zendesk backed by Durable Objects with
 * edge-native performance.
 *
 * Features:
 * - API-compatible with Zendesk Support API v2
 * - Tickets management (create, get, update, delete, list, search)
 * - Users management (create, get, update, search, merge)
 * - Organizations management (create, get, update, list)
 * - Comments (add, list)
 * - Attachments (upload, get)
 * - Triggers and Automations
 *
 * @example Basic Usage
 * ```typescript
 * import Zendesk from '@dotdo/zendesk'
 *
 * const client = new Zendesk.Client({
 *   subdomain: 'mycompany',
 *   email: 'admin@example.com',
 *   token: 'api_token',
 * })
 *
 * // Create a ticket
 * const ticket = await client.tickets.create({
 *   subject: 'Help needed',
 *   description: 'I need help with...',
 *   priority: 'high',
 *   type: 'incident',
 *   requester: { email: 'user@example.com' },
 * })
 * ```
 *
 * @example Tickets
 * ```typescript
 * import Zendesk from '@dotdo/zendesk'
 *
 * const client = new Zendesk.Client({
 *   subdomain: 'mycompany',
 *   email: 'admin@example.com',
 *   token: 'api_token',
 * })
 *
 * // List tickets
 * const tickets = await client.tickets.list({ status: 'open' })
 *
 * // Search tickets
 * const searchResults = await client.tickets.search('status:open priority:high')
 *
 * // Add a comment
 * await client.tickets.createComment(ticket.id, {
 *   body: 'Here is an update...',
 *   public: true,
 * })
 * ```
 *
 * @example Users
 * ```typescript
 * import Zendesk from '@dotdo/zendesk'
 *
 * const client = new Zendesk.Client({
 *   subdomain: 'mycompany',
 *   email: 'admin@example.com',
 *   token: 'api_token',
 * })
 *
 * // Create a user
 * const user = await client.users.create({
 *   name: 'John Doe',
 *   email: 'john@example.com',
 *   role: 'end-user',
 * })
 *
 * // Search users
 * const users = await client.users.search({ query: 'john@example.com' })
 * ```
 *
 * @example Organizations
 * ```typescript
 * import Zendesk from '@dotdo/zendesk'
 *
 * const client = new Zendesk.Client({
 *   subdomain: 'mycompany',
 *   email: 'admin@example.com',
 *   token: 'api_token',
 * })
 *
 * // Create an organization
 * const org = await client.organizations.create({
 *   name: 'Acme Inc',
 *   domain_names: ['acme.com'],
 * })
 * ```
 *
 * @see https://developer.zendesk.com/api-reference/
 */

// Re-export main client
export {
  Client,
  ZendeskError,
  TicketsResource,
  UsersResource,
  OrganizationsResource,
  AttachmentsResource,
  TriggersResource,
  AutomationsResource,
  TicketFieldsResource,
  TicketFormsResource,
  ViewsResource,
  MacrosResource,
  GroupsResource,
  WebhooksResource,
  TargetsResource,
} from './zendesk'

export { default } from './zendesk'

// Re-export local implementation
export { ZendeskLocal, type ZendeskLocalConfig } from './local'

// Re-export types
export type {
  // Core types
  CustomField,
  Via,
  SatisfactionRating,
  Thumbnail,

  // Ticket types
  Ticket,
  TicketRequester,
  TicketComment,
  TicketCreateParams,
  TicketUpdateParams,
  TicketListParams,
  TicketListResponse,
  SearchResponse,

  // User types
  User,
  UserPhoto,
  UserCreateParams,
  UserUpdateParams,
  UserSearchParams,
  UserListParams,
  UserListResponse,

  // Organization types
  Organization,
  OrganizationCreateParams,
  OrganizationUpdateParams,
  OrganizationListParams,
  OrganizationListResponse,

  // Comment types
  Comment,
  CommentCreateParams,
  CommentListParams,
  CommentListResponse,

  // Attachment types
  Attachment,
  AttachmentUploadParams,
  UploadResponse,

  // Trigger types
  Trigger,
  TriggerCondition,
  TriggerConditions,
  TriggerAction,
  TriggerCreateParams,
  TriggerUpdateParams,
  TriggerListParams,
  TriggerListResponse,

  // Automation types
  Automation,
  AutomationCreateParams,
  AutomationUpdateParams,
  AutomationListParams,
  AutomationListResponse,

  // Ticket Field types
  TicketField,
  TicketFieldOption,
  TicketFieldCreateParams,
  TicketFieldUpdateParams,
  TicketFieldListParams,
  TicketFieldListResponse,

  // Ticket Form types
  TicketForm,
  TicketFormCondition,
  TicketFormCreateParams,
  TicketFormUpdateParams,
  TicketFormListResponse,

  // View types
  View,
  ViewRestriction,
  ViewExecution,
  ViewColumn,
  ViewConditions,
  ViewCondition,
  ViewOutput,
  ViewCreateParams,
  ViewUpdateParams,
  ViewListParams,
  ViewListResponse,
  ViewCountResponse,
  ViewTicketsResponse,

  // Macro types
  Macro,
  MacroAction,
  MacroRestriction,
  MacroCreateParams,
  MacroUpdateParams,
  MacroListParams,
  MacroListResponse,
  MacroApplyResult,

  // Group types
  Group,
  GroupCreateParams,
  GroupUpdateParams,
  GroupListResponse,
  GroupMembership,
  GroupMembershipListResponse,

  // Webhook types
  Webhook,
  WebhookAuthentication,
  WebhookCreateParams,
  WebhookUpdateParams,
  WebhookListResponse,

  // Target types (legacy)
  Target,
  TargetCreateParams,
  TargetUpdateParams,
  TargetListResponse,

  // Brand types
  Brand,
  BrandListResponse,

  // SLA Policy types
  SLAPolicy,
  SLAPolicyCondition,
  SLAPolicyMetric,
  SLAPolicyListResponse,

  // Generic types
  ListResponse,

  // Error types
  ZendeskErrorDetail,
  ZendeskErrorResponse,

  // Client types
  ClientConfig,
  FetchFunction,
  RequestOptions,
} from './types'
