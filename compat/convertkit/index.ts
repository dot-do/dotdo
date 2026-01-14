/**
 * @dotdo/convertkit - ConvertKit (Kit) API v4 Compatibility Layer
 *
 * Drop-in replacement for ConvertKit API v4, backed by Durable Objects.
 * Compatible with https://developers.kit.com/v4.html
 *
 * @module @dotdo/convertkit
 */

// ==========================================================================
// Types
// ==========================================================================

export interface Subscriber {
  id: number
  email_address: string
  first_name: string | null
  state: SubscriberState
  created_at: string
  fields: Record<string, string | null>
  added_at?: string
}

export type SubscriberState = 'active' | 'inactive' | 'cancelled' | 'complained' | 'bounced'

export interface Tag {
  id: number
  name: string
  created_at: string
}

export interface Sequence {
  id: number
  name: string
  state: 'active' | 'draft' | 'paused'
  created_at: string
}

export interface CustomField {
  id: number
  key: string
  label: string
}

export interface SubscriberStats {
  emails_sent: number
  emails_opened: number
  emails_clicked: number
  open_rate?: number
  click_rate?: number
}

export interface CreateSubscriberInput {
  email_address: string
  first_name?: string
  fields?: Record<string, string>
}

export interface UpdateSubscriberInput {
  email_address?: string
  first_name?: string
  fields?: Record<string, string | null>
}

export interface BulkCreateResult {
  subscribers: Subscriber[]
  failures: Array<{ email_address: string; error: string }>
  job_id?: string
  status?: 'pending' | 'processing' | 'completed' | 'failed'
  callback_url?: string
}

export interface PaginatedResponse<T> {
  pagination: {
    has_previous_page: boolean
    has_next_page: boolean
    start_cursor?: string
    end_cursor?: string
    per_page?: number
  }
}

export interface SubscriberListResponse extends PaginatedResponse<Subscriber> {
  subscribers: Subscriber[]
}

export interface TagListResponse extends PaginatedResponse<Tag> {
  tags: Tag[]
}

export interface SequenceListResponse extends PaginatedResponse<Sequence> {
  sequences: Sequence[]
}

export interface ConvertKitError extends Error {
  status: number
  errors: Array<{ message: string; field?: string }>
}

export interface ConvertKitClientConfig {
  apiKey?: string
  accessToken?: string
  timeout?: number
}

export interface StatsOptions {
  from?: Date
  to?: Date
}

export interface ListOptions {
  after?: string
  before?: string
  per_page?: number
  email_address?: string
  state?: SubscriberState
  created_after?: Date
  created_before?: Date
  tag_id?: number
}

export interface BulkOptions {
  callback_url?: string
  tag_id?: number
}

// ==========================================================================
// Client
// ==========================================================================

/**
 * ConvertKit API v4 Client
 *
 * @example
 * ```ts
 * const client = new ConvertKitClient({ apiKey: 'ck_...' })
 * const subscriber = await client.subscribers.create({ email_address: 'user@example.com' })
 * ```
 */
export class ConvertKitClient {
  constructor(_config: ConvertKitClientConfig) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented')
  }

  get subscribers(): SubscribersResource {
    throw new Error('Not implemented')
  }

  get tags(): TagsResource {
    throw new Error('Not implemented')
  }

  get sequences(): SequencesResource {
    throw new Error('Not implemented')
  }

  get customFields(): CustomFieldsResource {
    throw new Error('Not implemented')
  }

  get bulk(): BulkResource {
    throw new Error('Not implemented')
  }
}

// ==========================================================================
// Resources (interfaces for client resources)
// ==========================================================================

interface SubscribersResource {
  create(input: CreateSubscriberInput): Promise<Subscriber>
  get(id: number): Promise<Subscriber>
  update(id: number, input: UpdateSubscriberInput): Promise<Subscriber>
  list(options?: ListOptions): Promise<SubscriberListResponse>
  unsubscribe(id: number): Promise<Subscriber>
  getStats(id: number, options?: StatsOptions): Promise<SubscriberStats>
  listTags(id: number): Promise<TagListResponse>
  listSequences(id: number): Promise<SequenceListResponse>
  setField(id: number, key: string, value: string): Promise<Subscriber>
  setFields(id: number, fields: Record<string, string | null>): Promise<Subscriber>
  bulkCreate(subscribers: CreateSubscriberInput[], options?: BulkOptions): Promise<BulkCreateResult>
}

interface TagsResource {
  addSubscriber(tagId: number, subscriberId: number): Promise<Subscriber>
  addSubscriberByEmail(tagId: number, email: string): Promise<Subscriber>
  removeSubscriber(tagId: number, subscriberId: number): Promise<void>
  listSubscribers(tagId: number, options?: ListOptions): Promise<SubscriberListResponse>
}

interface SequencesResource {
  addSubscriber(sequenceId: number, subscriberId: number): Promise<Subscriber>
  addSubscriberByEmail(sequenceId: number, email: string): Promise<Subscriber>
  removeSubscriber(sequenceId: number, subscriberId: number): Promise<void>
  listSubscribers(sequenceId: number, options?: ListOptions): Promise<SubscriberListResponse>
}

interface CustomFieldsResource {
  list(): Promise<CustomField[]>
  create(input: { label: string }): Promise<CustomField>
}

interface BulkResource {
  getJobStatus(jobId: string): Promise<{
    job_id: string
    status: 'pending' | 'processing' | 'completed' | 'failed'
    created?: number
    failures?: number
    completed_at?: string
  }>
}

// ==========================================================================
// Standalone Functions
// ==========================================================================

export async function createSubscriber(
  _input: CreateSubscriberInput,
  _config: ConvertKitClientConfig
): Promise<Subscriber> {
  throw new Error('Not implemented')
}

export async function getSubscriber(
  _id: number,
  _config: ConvertKitClientConfig
): Promise<Subscriber> {
  throw new Error('Not implemented')
}

export async function updateSubscriber(
  _id: number,
  _input: UpdateSubscriberInput,
  _config: ConvertKitClientConfig
): Promise<Subscriber> {
  throw new Error('Not implemented')
}

export async function listSubscribers(
  _options: ListOptions,
  _config: ConvertKitClientConfig
): Promise<SubscriberListResponse> {
  throw new Error('Not implemented')
}

export async function unsubscribeSubscriber(
  _id: number,
  _config: ConvertKitClientConfig
): Promise<Subscriber> {
  throw new Error('Not implemented')
}

export async function getSubscriberStats(
  _id: number,
  _options: StatsOptions,
  _config: ConvertKitClientConfig
): Promise<SubscriberStats> {
  throw new Error('Not implemented')
}

export async function addTagToSubscriber(
  _tagId: number,
  _subscriberId: number,
  _config: ConvertKitClientConfig
): Promise<Subscriber> {
  throw new Error('Not implemented')
}

export async function removeTagFromSubscriber(
  _tagId: number,
  _subscriberId: number,
  _config: ConvertKitClientConfig
): Promise<void> {
  throw new Error('Not implemented')
}

export async function listSubscriberTags(
  _subscriberId: number,
  _config: ConvertKitClientConfig
): Promise<TagListResponse> {
  throw new Error('Not implemented')
}

export async function addSubscriberToSequence(
  _sequenceId: number,
  _subscriberId: number,
  _config: ConvertKitClientConfig
): Promise<Subscriber> {
  throw new Error('Not implemented')
}

export async function removeSubscriberFromSequence(
  _sequenceId: number,
  _subscriberId: number,
  _config: ConvertKitClientConfig
): Promise<void> {
  throw new Error('Not implemented')
}

export async function listSubscriberSequences(
  _subscriberId: number,
  _config: ConvertKitClientConfig
): Promise<SequenceListResponse> {
  throw new Error('Not implemented')
}

export async function setSubscriberCustomField(
  _subscriberId: number,
  _key: string,
  _value: string,
  _config: ConvertKitClientConfig
): Promise<Subscriber> {
  throw new Error('Not implemented')
}

export async function setSubscriberCustomFields(
  _subscriberId: number,
  _fields: Record<string, string | null>,
  _config: ConvertKitClientConfig
): Promise<Subscriber> {
  throw new Error('Not implemented')
}

export async function bulkCreateSubscribers(
  _subscribers: CreateSubscriberInput[],
  _config: ConvertKitClientConfig
): Promise<BulkCreateResult> {
  throw new Error('Not implemented')
}
