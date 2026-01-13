/**
 * @dotdo/helpscout - Help Scout API Type Definitions
 *
 * Type definitions for Help Scout API compatibility layer.
 * Based on Help Scout API v2 (Mailbox API 2.0)
 *
 * @see https://developer.helpscout.com/mailbox-api/
 * @module @dotdo/helpscout/types
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Help Scout conversation status
 */
export type ConversationStatus = 'active' | 'pending' | 'closed' | 'spam'

/**
 * Help Scout conversation type
 */
export type ConversationType = 'email' | 'phone' | 'chat'

/**
 * Thread type
 */
export type ThreadType = 'customer' | 'note' | 'reply' | 'lineitem' | 'phone' | 'forwardchild' | 'forwardparent'

/**
 * Thread state
 */
export type ThreadState = 'published' | 'draft' | 'hidden'

/**
 * Thread action type
 */
export type ThreadAction = 'movedFromMailbox' | 'merged' | 'imported' | 'workflow' | 'importedExternal' | 'changedTicketCustomer' | 'deletedTicket' | 'restoredTicket'

// =============================================================================
// HAL Links (Help Scout uses HAL+JSON)
// =============================================================================

/**
 * HAL link
 */
export interface HalLink {
  href: string
}

/**
 * HAL links collection
 */
export interface HalLinks {
  self: HalLink
  [key: string]: HalLink
}

/**
 * HAL embedded resources
 */
export interface HalEmbedded<T> {
  [key: string]: T[]
}

/**
 * HAL page info
 */
export interface HalPage {
  size: number
  totalElements: number
  totalPages: number
  number: number
}

/**
 * HAL collection response
 */
export interface HalCollectionResponse<T> {
  _embedded: HalEmbedded<T>
  _links: HalLinks
  page: HalPage
}

// =============================================================================
// Conversation Types
// =============================================================================

/**
 * Source information
 */
export interface Source {
  type: 'email' | 'web' | 'notification' | 'emailFwd' | 'api' | 'chat'
  via: 'customer' | 'user'
}

/**
 * Customer reference
 */
export interface CustomerRef {
  id: number
  email: string
  firstName?: string
  lastName?: string
  type: 'customer'
}

/**
 * User reference (agent)
 */
export interface UserRef {
  id: number
  email: string
  firstName?: string
  lastName?: string
  type: 'user'
}

/**
 * Mailbox reference
 */
export interface MailboxRef {
  id: number
  name: string
}

/**
 * Tag reference
 */
export interface TagRef {
  id: number
  tag: string
  color?: string
}

/**
 * Custom field value
 */
export interface CustomFieldValue {
  id: number
  name: string
  value: string | number | boolean | null
}

/**
 * Help Scout Conversation object
 */
export interface Conversation {
  id: number
  number: number
  threads: number
  type: ConversationType
  folderId: number
  status: ConversationStatus
  state: 'published' | 'draft' | 'deleted'
  subject: string
  preview: string
  mailboxId: number
  assignee?: UserRef
  createdBy: CustomerRef | UserRef
  createdAt: string
  closedBy?: UserRef
  closedByUser?: UserRef
  closedAt?: string
  userUpdatedAt?: string
  customerWaitingSince?: { time: string; friendly: string }
  source: Source
  tags: TagRef[]
  cc: string[]
  bcc: string[]
  primaryCustomer: CustomerRef
  customFields: CustomFieldValue[]
  _embedded?: {
    threads?: Thread[]
  }
  _links: HalLinks
}

/**
 * Thread object
 */
export interface Thread {
  id: number
  type: ThreadType
  status: 'active' | 'nochange' | 'pending' | 'closed' | 'spam'
  state: ThreadState
  action?: {
    type: ThreadAction
    text: string
    associatedEntities?: Record<string, unknown>
  }
  body: string
  source: Source
  customer?: CustomerRef
  createdBy: CustomerRef | UserRef
  assignedTo?: UserRef
  savedReplyId?: number
  to?: string[]
  cc?: string[]
  bcc?: string[]
  createdAt: string
  openedAt?: string
  _links: HalLinks
  _embedded?: {
    attachments?: Attachment[]
  }
}

/**
 * Parameters for creating a conversation
 */
export interface ConversationCreateParams {
  subject: string
  customer: {
    id?: number
    email: string
    firstName?: string
    lastName?: string
  }
  mailboxId: number
  type: ConversationType
  status?: ConversationStatus
  assignTo?: number
  createdAt?: string
  closedAt?: string
  autoReply?: boolean
  imported?: boolean
  tags?: string[]
  cc?: string[]
  bcc?: string[]
  threads: ThreadCreateParams[]
  user?: number
  customFields?: { id: number; value: string | number | boolean }[]
}

/**
 * Parameters for creating a thread
 */
export interface ThreadCreateParams {
  type: 'customer' | 'note' | 'reply' | 'phone'
  customer?: {
    id?: number
    email?: string
  }
  text: string
  user?: number
  imported?: boolean
  createdAt?: string
  cc?: string[]
  bcc?: string[]
  attachments?: number[]
}

/**
 * Parameters for updating a conversation
 */
export interface ConversationUpdateParams {
  op: 'move' | 'replace'
  path: '/status' | '/assignTo' | '/mailboxId' | '/subject' | '/customFields' | '/primaryCustomer.id'
  value: string | number | { id: number; value: string | number | boolean }[]
}

/**
 * Parameters for listing conversations
 */
export interface ConversationListParams {
  mailbox?: number
  folder?: number
  status?: ConversationStatus
  tag?: string
  assigned_to?: number
  modifiedSince?: string
  sortField?: 'createdAt' | 'customerEmail' | 'mailboxid' | 'modifiedAt' | 'number' | 'score' | 'status' | 'subject' | 'waitingSince'
  sortOrder?: 'asc' | 'desc'
  page?: number
  pageSize?: number
  query?: string
  embed?: 'threads'
}

/**
 * Parameters for searching conversations
 */
export interface ConversationSearchParams {
  query: string
  page?: number
  pageSize?: number
  sortField?: string
  sortOrder?: 'asc' | 'desc'
}

// =============================================================================
// Customer Types
// =============================================================================

/**
 * Customer social profile
 */
export interface SocialProfile {
  type: 'twitter' | 'facebook' | 'linkedin' | 'googleplus' | 'tungleme' | 'quora' | 'foursquare' | 'youtube' | 'flickr' | 'other'
  value: string
}

/**
 * Customer email
 */
export interface CustomerEmail {
  id?: number
  type: 'home' | 'work' | 'other'
  value: string
}

/**
 * Customer phone
 */
export interface CustomerPhone {
  id?: number
  type: 'home' | 'work' | 'mobile' | 'fax' | 'pager' | 'other'
  value: string
}

/**
 * Customer website
 */
export interface CustomerWebsite {
  value: string
}

/**
 * Customer address
 */
export interface CustomerAddress {
  id?: number
  lines?: string[]
  city?: string
  state?: string
  postalCode?: string
  country?: string
}

/**
 * Customer chat handle
 */
export interface CustomerChat {
  id?: number
  type: 'aim' | 'gtalk' | 'icq' | 'xmpp' | 'msn' | 'skype' | 'yahoo' | 'qq' | 'other'
  value: string
}

/**
 * Customer property
 */
export interface CustomerProperty {
  type: string
  slug: string
  name: string
  value: string
}

/**
 * Help Scout Customer object
 */
export interface Customer {
  id: number
  firstName?: string
  lastName?: string
  photoUrl?: string
  photoType?: 'unknown' | 'gravatar' | 'twitter' | 'facebook' | 'googleprofile' | 'googleplus' | 'linkedin'
  gender?: 'male' | 'female' | 'unknown'
  age?: string
  organization?: string
  jobTitle?: string
  location?: string
  background?: string
  createdAt: string
  updatedAt?: string
  _embedded?: {
    emails?: CustomerEmail[]
    phones?: CustomerPhone[]
    social_profiles?: SocialProfile[]
    websites?: CustomerWebsite[]
    chats?: CustomerChat[]
    addresses?: CustomerAddress[]
  }
  _links: HalLinks
}

/**
 * Parameters for creating a customer
 */
export interface CustomerCreateParams {
  firstName?: string
  lastName?: string
  emails?: CustomerEmail[]
  phones?: CustomerPhone[]
  socialProfiles?: SocialProfile[]
  websites?: CustomerWebsite[]
  chats?: CustomerChat[]
  addresses?: CustomerAddress[]
  organization?: string
  jobTitle?: string
  location?: string
  background?: string
  gender?: 'male' | 'female' | 'unknown'
  age?: string
  photoUrl?: string
}

/**
 * Parameters for updating a customer
 */
export interface CustomerUpdateParams {
  firstName?: string
  lastName?: string
  organization?: string
  jobTitle?: string
  location?: string
  background?: string
  gender?: 'male' | 'female' | 'unknown'
  age?: string
  photoUrl?: string
}

/**
 * Parameters for listing customers
 */
export interface CustomerListParams {
  email?: string
  firstName?: string
  lastName?: string
  mailbox?: number
  modifiedSince?: string
  sortField?: 'firstName' | 'lastName' | 'modifiedAt'
  sortOrder?: 'asc' | 'desc'
  page?: number
  pageSize?: number
  query?: string
}

// =============================================================================
// Mailbox Types
// =============================================================================

/**
 * Help Scout Mailbox object
 */
export interface Mailbox {
  id: number
  name: string
  slug: string
  email: string
  createdAt: string
  updatedAt?: string
  _links: HalLinks
}

/**
 * Mailbox folder
 */
export interface Folder {
  id: number
  name: string
  type: 'needsattention' | 'drafts' | 'assigned' | 'open' | 'closed' | 'spam' | 'mine'
  userId?: number
  totalCount: number
  activeCount: number
  updatedAt?: string
  _links: HalLinks
}

/**
 * Mailbox fields (custom fields)
 */
export interface MailboxField {
  id: number
  name: string
  type: 'singleline' | 'multiline' | 'date' | 'number' | 'dropdown'
  required: boolean
  order: number
  options?: { id: number; label: string; order: number }[]
  _links: HalLinks
}

// =============================================================================
// User (Agent) Types
// =============================================================================

/**
 * Help Scout User object
 */
export interface User {
  id: number
  firstName: string
  lastName: string
  email: string
  role: 'owner' | 'admin' | 'user'
  timezone: string
  photoUrl?: string
  type: 'team' | 'user'
  createdAt: string
  updatedAt?: string
  _links: HalLinks
}

/**
 * Parameters for listing users
 */
export interface UserListParams {
  mailbox?: number
  email?: string
  page?: number
  pageSize?: number
}

// =============================================================================
// Saved Reply (Macro) Types
// =============================================================================

/**
 * Help Scout Saved Reply object
 */
export interface SavedReply {
  id: number
  mailboxId: number
  name: string
  text: string
  createdAt: string
  modifiedAt?: string
  _links: HalLinks
}

/**
 * Parameters for creating a saved reply
 */
export interface SavedReplyCreateParams {
  mailboxId: number
  name: string
  text: string
}

/**
 * Parameters for updating a saved reply
 */
export interface SavedReplyUpdateParams {
  name?: string
  text?: string
}

// =============================================================================
// Tag Types
// =============================================================================

/**
 * Help Scout Tag object
 */
export interface Tag {
  id: number
  tag: string
  slug: string
  color?: string
  ticketCount?: number
  createdAt: string
  updatedAt?: string
  _links: HalLinks
}

/**
 * Parameters for creating a tag
 */
export interface TagCreateParams {
  tag: string
  color?: string
}

// =============================================================================
// Workflow Types
// =============================================================================

/**
 * Help Scout Workflow object
 */
export interface Workflow {
  id: number
  mailboxId: number
  name: string
  type: 'automatic' | 'manual'
  status: 'active' | 'inactive' | 'invalid'
  order: number
  createdAt: string
  modifiedAt?: string
  _links: HalLinks
}

// =============================================================================
// Docs (Knowledge Base) Types
// =============================================================================

/**
 * Docs site
 */
export interface DocsSite {
  id: string
  status: 'draft' | 'published'
  subDomain: string
  cname: string
  hasPublicSite: boolean
  companyName: string
  title: string
  logoUrl: string
  logoWidth: number
  logoHeight: number
  favIconUrl: string
  touchIconUrl: string
  homeUrl: string
  homeLinkText: string
  bgColor: string
  description: string
  hasContactForm: boolean
  mailboxId: number
  contactEmail: string
  styleSheetUrl: string
  headerCode: string
  createdAt: string
  updatedAt?: string
}

/**
 * Docs collection
 */
export interface DocsCollection {
  id: string
  siteId: string
  number: number
  slug: string
  visibility: 'public' | 'private'
  order: number
  name: string
  description?: string
  publicArticleCount: number
  createdAt: string
  updatedAt?: string
  _links: HalLinks
}

/**
 * Docs article
 */
export interface DocsArticle {
  id: string
  collectionId: string
  number: number
  slug: string
  status: 'published' | 'notpublished'
  visibility: 'public' | 'private'
  name: string
  text: string
  publicUrl: string
  popularity: number
  viewCount: number
  hasDraft: boolean
  createdBy: number
  createdAt: string
  updatedBy?: number
  updatedAt?: string
  _links: HalLinks
}

/**
 * Parameters for creating a Docs article
 */
export interface DocsArticleCreateParams {
  collectionId: string
  name: string
  text: string
  status?: 'published' | 'notpublished'
  visibility?: 'public' | 'private'
  slug?: string
}

/**
 * Parameters for updating a Docs article
 */
export interface DocsArticleUpdateParams {
  name?: string
  text?: string
  status?: 'published' | 'notpublished'
  visibility?: 'public' | 'private'
  slug?: string
}

// =============================================================================
// Attachment Types
// =============================================================================

/**
 * Help Scout Attachment object
 */
export interface Attachment {
  id: number
  fileName: string
  mimeType: string
  size: number
  width?: number
  height?: number
  url?: string
  _links: HalLinks
}

/**
 * Parameters for creating an attachment
 */
export interface AttachmentCreateParams {
  fileName: string
  mimeType: string
  data: string // Base64 encoded
}

// =============================================================================
// Webhook Types
// =============================================================================

/**
 * Help Scout Webhook object
 */
export interface Webhook {
  id: number
  url: string
  events: string[]
  state: 'enabled' | 'disabled'
  secret: string
  payloadVersion: string
  label?: string
  _links: HalLinks
}

/**
 * Parameters for creating a webhook
 */
export interface WebhookCreateParams {
  url: string
  events: string[]
  secret: string
  payloadVersion?: string
  label?: string
}

// =============================================================================
// Report Types
// =============================================================================

/**
 * Conversation report
 */
export interface ConversationReport {
  current: {
    startDate: string
    endDate: string
    totalConversations: number
    conversationsCreated: number
    newConversations: number
    customers: number
    conversationsPerDay: number
  }
  previous?: {
    startDate: string
    endDate: string
    totalConversations: number
    conversationsCreated: number
    newConversations: number
    customers: number
    conversationsPerDay: number
  }
  deltas?: {
    totalConversations: number
    conversationsCreated: number
    newConversations: number
    customers: number
    conversationsPerDay: number
  }
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Help Scout API error detail
 */
export interface HelpScoutErrorDetail {
  path?: string
  message: string
  source?: string
}

/**
 * Help Scout API error response
 */
export interface HelpScoutErrorResponse {
  status?: number
  error?: string
  message?: string
  _embedded?: {
    errors?: HelpScoutErrorDetail[]
  }
}

// =============================================================================
// Client Configuration Types
// =============================================================================

/**
 * Fetch function type for custom fetch implementations
 */
export type FetchFunction = (
  url: string,
  options?: RequestInit
) => Promise<{
  ok: boolean
  status: number
  headers: Headers
  json: () => Promise<unknown>
}>

/**
 * OAuth2 credentials
 */
export interface OAuth2Credentials {
  clientId: string
  clientSecret: string
  accessToken?: string
  refreshToken?: string
}

/**
 * Client configuration
 */
export interface ClientConfig {
  /** OAuth2 credentials */
  oauth: OAuth2Credentials
  /** Custom fetch function for edge environments */
  fetch?: typeof fetch | FetchFunction
  /** API base URL (default: https://api.helpscout.net) */
  baseUrl?: string
}

/**
 * Request options
 */
export interface RequestOptions {
  /** Request timeout in milliseconds */
  timeout?: number
}
