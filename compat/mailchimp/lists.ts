/**
 * @dotdo/mailchimp/lists - Mailchimp Lists/Audiences API Compatibility Layer
 *
 * Drop-in replacement for Mailchimp Lists API backed by Durable Objects.
 * Provides list management, member operations, segments, tags, and webhooks.
 *
 * @example
 * ```typescript
 * import { MailchimpLists } from '@dotdo/mailchimp/lists'
 *
 * const lists = new MailchimpLists(storage)
 *
 * // Create a list
 * const list = await lists.create({
 *   name: 'Newsletter',
 *   contact: { company: 'Acme', address1: '123 Main', city: 'NYC', state: 'NY', zip: '10001', country: 'US' },
 *   permissionReminder: 'You signed up on our website',
 *   campaignDefaults: { fromName: 'Acme', fromEmail: 'news@acme.com', subject: 'Newsletter', language: 'en' },
 * })
 *
 * // Add a member
 * await lists.members.add(list.id, {
 *   emailAddress: 'user@example.com',
 *   status: 'subscribed',
 *   mergeFields: { FNAME: 'John', LNAME: 'Doe' },
 * })
 * ```
 *
 * @module @dotdo/mailchimp/lists
 */

import { createHash } from 'node:crypto'

// =============================================================================
// Types - Storage
// =============================================================================

export interface ListsStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: { prefix?: string; limit?: number }): Promise<Map<string, unknown>>
}

// =============================================================================
// Types - Lists
// =============================================================================

export interface ListContact {
  company: string
  address1: string
  address2?: string
  city: string
  state: string
  zip: string
  country: string
  phone?: string
}

export interface CampaignDefaults {
  fromName: string
  fromEmail: string
  subject: string
  language: string
}

export interface ListStats {
  memberCount: number
  unsubscribeCount: number
  cleanedCount: number
  memberCountSinceSend: number
  unsubscribeCountSinceSend: number
  cleanedCountSinceSend: number
  campaignCount: number
  campaignLastSent?: string
  mergeFieldCount: number
  avgSubRate: number
  avgUnsubRate: number
  targetSubRate: number
  openRate: number
  clickRate: number
  lastSubDate?: string
  lastUnsubDate?: string
}

export interface List {
  id: string
  webId: number
  name: string
  contact: ListContact
  permissionReminder: string
  useArchiveBar: boolean
  campaignDefaults: CampaignDefaults
  notifyOnSubscribe: string
  notifyOnUnsubscribe: string
  dateCreated: string
  listRating: number
  emailTypeOption: boolean
  subscribeUrlShort: string
  subscribeUrlLong: string
  beamerAddress: string
  visibility: 'pub' | 'prv'
  doubleOptin: boolean
  hasWelcome: boolean
  marketingPermissions: boolean
  modules: string[]
  stats: ListStats
}

export interface CreateListInput {
  name: string
  contact: ListContact
  permissionReminder: string
  campaignDefaults: CampaignDefaults
  useArchiveBar?: boolean
  notifyOnSubscribe?: string
  notifyOnUnsubscribe?: string
  emailTypeOption?: boolean
  visibility?: 'pub' | 'prv'
  doubleOptin?: boolean
  marketingPermissions?: boolean
}

export interface UpdateListInput {
  name?: string
  contact?: Partial<ListContact>
  permissionReminder?: string
  campaignDefaults?: CampaignDefaults
  useArchiveBar?: boolean
  notifyOnSubscribe?: string
  notifyOnUnsubscribe?: string
  emailTypeOption?: boolean
  visibility?: 'pub' | 'prv'
  doubleOptin?: boolean
  marketingPermissions?: boolean
}

export interface ListListResult {
  lists: List[]
  totalItems: number
  constraintType?: string
}

// =============================================================================
// Types - Members
// =============================================================================

export type MemberStatus = 'subscribed' | 'unsubscribed' | 'cleaned' | 'pending' | 'transactional' | 'archived'

export interface MergeFields {
  [key: string]: string | number | boolean
}

export interface MemberLocation {
  latitude?: number
  longitude?: number
  gmtoff?: number
  dstoff?: number
  countryCode?: string
  timezone?: string
  region?: string
}

export interface Member {
  id: string
  emailAddress: string
  uniqueEmailId: string
  contactId?: string
  fullName?: string
  webId: number
  emailType: 'html' | 'text'
  status: MemberStatus
  unsubscribeReason?: string
  consentsToOneToOneMessaging: boolean
  mergeFields: MergeFields
  interests: Record<string, boolean>
  stats: {
    avgOpenRate: number
    avgClickRate: number
    ecommerceData: {
      totalRevenue: number
      numberOfOrders: number
      currencyCode: string
    }
  }
  ipSignup?: string
  timestampSignup?: string
  ipOpt?: string
  timestampOpt?: string
  memberRating: number
  lastChanged: string
  language: string
  vip: boolean
  emailClient?: string
  location: MemberLocation
  marketingPermissions: Array<{
    marketingPermissionId: string
    text: string
    enabled: boolean
  }>
  lastNote?: {
    noteId: number
    createdAt: string
    createdBy: string
    note: string
  }
  source: string
  tagsCount: number
  tags: string[]
  listId: string
}

export interface AddMemberInput {
  emailAddress: string
  status: MemberStatus
  emailType?: 'html' | 'text'
  mergeFields?: MergeFields
  interests?: Record<string, boolean>
  language?: string
  vip?: boolean
  location?: Partial<MemberLocation>
  marketingPermissions?: Array<{ marketingPermissionId: string; enabled: boolean }>
  ipSignup?: string
  timestampSignup?: string
  ipOpt?: string
  timestampOpt?: string
  tags?: string[]
}

export interface UpdateMemberInput {
  emailAddress?: string
  status?: MemberStatus
  emailType?: 'html' | 'text'
  mergeFields?: MergeFields
  interests?: Record<string, boolean>
  language?: string
  vip?: boolean
  location?: Partial<MemberLocation>
  marketingPermissions?: Array<{ marketingPermissionId: string; enabled: boolean }>
  ipOpt?: string
  timestampOpt?: string
}

export interface ListMembersOptions {
  status?: MemberStatus
  count?: number
  offset?: number
  sortField?: 'timestamp_opt' | 'timestamp_signup' | 'last_changed'
  sortDir?: 'ASC' | 'DESC'
}

export interface ListMembersResult {
  members: Member[]
  listId: string
  totalItems: number
}

export interface BatchMembersInput {
  members: AddMemberInput[]
  syncTags?: boolean
  updateExisting?: boolean
}

export interface BatchMembersResult {
  newMembers: Member[]
  updatedMembers: Member[]
  errors: Array<{ emailAddress: string; error: string; errorCode: string }>
  totalCreated: number
  totalUpdated: number
  errorCount: number
}

// =============================================================================
// Types - Segments
// =============================================================================

export type SegmentType = 'saved' | 'static' | 'fuzzy'

export interface SegmentCondition {
  conditionType: string
  field: string
  op: string
  value?: string | number | boolean
  extra?: string
}

export interface SegmentOptions {
  match: 'any' | 'all'
  conditions: SegmentCondition[]
}

export interface Segment {
  id: string
  name: string
  memberCount: number
  type: SegmentType
  createdAt: string
  updatedAt: string
  options?: SegmentOptions
  listId: string
}

export interface CreateSegmentInput {
  name: string
  staticSegment?: string[]
  options?: SegmentOptions
}

export interface UpdateSegmentInput {
  name?: string
  staticSegment?: string[]
  options?: SegmentOptions
}

export interface ListSegmentsResult {
  segments: Segment[]
  listId: string
  totalItems: number
}

// =============================================================================
// Types - Tags
// =============================================================================

export interface Tag {
  id: string
  name: string
  memberCount: number
  dateAdded: string
}

export interface CreateTagInput {
  name: string
}

export interface ListTagsResult {
  tags: Tag[]
  totalItems: number
}

// =============================================================================
// Types - Webhooks
// =============================================================================

export interface WebhookEvents {
  subscribe?: boolean
  unsubscribe?: boolean
  profile?: boolean
  cleaned?: boolean
  upemail?: boolean
  campaign?: boolean
}

export interface WebhookSources {
  user?: boolean
  admin?: boolean
  api?: boolean
}

export interface Webhook {
  id: string
  url: string
  events: WebhookEvents
  sources: WebhookSources
  listId: string
}

export interface CreateWebhookInput {
  url: string
  events: WebhookEvents
  sources: WebhookSources
}

export interface UpdateWebhookInput {
  url?: string
  events?: WebhookEvents
  sources?: WebhookSources
}

export interface ListWebhooksResult {
  webhooks: Webhook[]
  listId: string
  totalItems: number
}

// =============================================================================
// Error Class
// =============================================================================

export class MailchimpError extends Error {
  type: string
  title: string
  status: number
  detail: string
  instance: string
  errors?: Array<{ field: string; message: string }>

  constructor(
    title: string,
    status: number,
    detail: string,
    errors?: Array<{ field: string; message: string }>
  ) {
    super(detail)
    this.name = 'MailchimpError'
    this.type = 'https://mailchimp.com/developer/marketing/docs/errors/'
    this.title = title
    this.status = status
    this.detail = detail
    this.instance = generateId('error')
    this.errors = errors
  }
}

// =============================================================================
// Utilities
// =============================================================================

function generateId(prefix: string = 'mc'): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

function now(): string {
  return new Date().toISOString()
}

function md5Hash(str: string): string {
  return createHash('md5').update(str.toLowerCase()).digest('hex')
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

// =============================================================================
// Members API
// =============================================================================

export class MembersApi {
  private storage: ListsStorage
  private readonly PREFIX = 'member:'
  private readonly EMAIL_INDEX = 'member_email:'
  private listApi: () => Promise<List>
  private updateListStats: (listId: string, updates: Partial<ListStats>) => Promise<void>

  constructor(
    storage: ListsStorage,
    listApi: () => Promise<List>,
    updateListStats: (listId: string, updates: Partial<ListStats>) => Promise<void>
  ) {
    this.storage = storage
    this.listApi = listApi
    this.updateListStats = updateListStats
  }

  async add(listId: string, input: AddMemberInput): Promise<Member> {
    // Validate email
    if (!isValidEmail(input.emailAddress)) {
      throw new MailchimpError(
        'Invalid Resource',
        400,
        'Please provide a valid email address.',
        [{ field: 'email_address', message: 'Please provide a valid email address.' }]
      )
    }

    // Check for duplicate
    const emailHash = md5Hash(input.emailAddress)
    const existingKey = `${this.EMAIL_INDEX}${listId}:${emailHash}`
    const existing = await this.storage.get<string>(existingKey)
    if (existing) {
      throw new MailchimpError(
        'Member Exists',
        400,
        `${input.emailAddress} is already a list member. Use PATCH to update existing members.`
      )
    }

    const id = emailHash
    const timestamp = now()

    const member: Member = {
      id,
      emailAddress: input.emailAddress,
      uniqueEmailId: generateId('unique'),
      webId: Math.floor(Math.random() * 1000000000),
      emailType: input.emailType ?? 'html',
      status: input.status,
      consentsToOneToOneMessaging: true,
      mergeFields: input.mergeFields ?? {},
      interests: input.interests ?? {},
      stats: {
        avgOpenRate: 0,
        avgClickRate: 0,
        ecommerceData: { totalRevenue: 0, numberOfOrders: 0, currencyCode: 'USD' },
      },
      ipSignup: input.ipSignup,
      timestampSignup: input.timestampSignup ?? timestamp,
      ipOpt: input.ipOpt,
      timestampOpt: input.timestampOpt ?? timestamp,
      memberRating: 2,
      lastChanged: timestamp,
      language: input.language ?? 'en',
      vip: input.vip ?? false,
      location: input.location ?? {},
      marketingPermissions: input.marketingPermissions?.map((mp) => ({
        marketingPermissionId: mp.marketingPermissionId,
        text: '',
        enabled: mp.enabled,
      })) ?? [],
      source: 'API',
      tagsCount: input.tags?.length ?? 0,
      tags: input.tags ?? [],
      listId,
    }

    await this.storage.put(`${this.PREFIX}${listId}:${id}`, member)
    await this.storage.put(existingKey, id)

    // Update list stats
    const list = await this.listApi()
    await this.updateListStats(listId, {
      memberCount: list.stats.memberCount + 1,
      lastSubDate: timestamp,
    })

    return member
  }

  async get(listId: string, memberId: string): Promise<Member> {
    const member = await this.storage.get<Member>(`${this.PREFIX}${listId}:${memberId}`)
    if (!member || member.status === 'archived') {
      throw new MailchimpError(
        'Resource Not Found',
        404,
        'The requested resource could not be found.'
      )
    }
    return member
  }

  async getByEmail(listId: string, email: string): Promise<Member> {
    const emailHash = md5Hash(email)
    return this.get(listId, emailHash)
  }

  async update(listId: string, memberId: string, input: UpdateMemberInput): Promise<Member> {
    const member = await this.get(listId, memberId)
    const previousStatus = member.status
    const timestamp = now()

    const updated: Member = {
      ...member,
      emailAddress: input.emailAddress ?? member.emailAddress,
      status: input.status ?? member.status,
      emailType: input.emailType ?? member.emailType,
      mergeFields: { ...member.mergeFields, ...input.mergeFields },
      interests: { ...member.interests, ...input.interests },
      language: input.language ?? member.language,
      vip: input.vip ?? member.vip,
      location: { ...member.location, ...input.location },
      ipOpt: input.ipOpt ?? member.ipOpt,
      timestampOpt: input.timestampOpt ?? member.timestampOpt,
      lastChanged: timestamp,
    }

    await this.storage.put(`${this.PREFIX}${listId}:${memberId}`, updated)

    // Update list stats if status changed
    if (previousStatus !== updated.status) {
      const list = await this.listApi()
      const updates: Partial<ListStats> = {}

      if (previousStatus === 'subscribed' && updated.status === 'unsubscribed') {
        updates.unsubscribeCount = list.stats.unsubscribeCount + 1
        updates.lastUnsubDate = timestamp
      }
      if (updated.status === 'cleaned') {
        updates.cleanedCount = list.stats.cleanedCount + 1
      }

      if (Object.keys(updates).length > 0) {
        await this.updateListStats(listId, updates)
      }
    }

    return updated
  }

  async delete(listId: string, memberId: string): Promise<void> {
    const member = await this.get(listId, memberId)
    member.status = 'archived'
    member.lastChanged = now()
    await this.storage.put(`${this.PREFIX}${listId}:${memberId}`, member)
  }

  async deletePermanently(listId: string, memberId: string): Promise<void> {
    const member = await this.get(listId, memberId)
    const emailHash = md5Hash(member.emailAddress)
    await this.storage.delete(`${this.PREFIX}${listId}:${memberId}`)
    await this.storage.delete(`${this.EMAIL_INDEX}${listId}:${emailHash}`)
  }

  async list(listId: string, options?: ListMembersOptions): Promise<ListMembersResult> {
    const membersMap = await this.storage.list({ prefix: `${this.PREFIX}${listId}:` })
    let members: Member[] = []

    for (const value of membersMap.values()) {
      const member = value as Member
      if (member.status === 'archived') continue
      if (options?.status && member.status !== options.status) continue
      members.push(member)
    }

    // Sort
    const sortField = options?.sortField ?? 'last_changed'
    const sortDir = options?.sortDir ?? 'DESC'
    members.sort((a, b) => {
      let aVal: string, bVal: string
      switch (sortField) {
        case 'timestamp_opt':
          aVal = a.timestampOpt ?? ''
          bVal = b.timestampOpt ?? ''
          break
        case 'timestamp_signup':
          aVal = a.timestampSignup ?? ''
          bVal = b.timestampSignup ?? ''
          break
        default:
          aVal = a.lastChanged
          bVal = b.lastChanged
      }
      return sortDir === 'ASC' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    })

    const totalItems = members.length
    const offset = options?.offset ?? 0
    const count = options?.count ?? 10
    members = members.slice(offset, offset + count)

    return { members, listId, totalItems }
  }

  async batch(listId: string, input: BatchMembersInput): Promise<BatchMembersResult> {
    const result: BatchMembersResult = {
      newMembers: [],
      updatedMembers: [],
      errors: [],
      totalCreated: 0,
      totalUpdated: 0,
      errorCount: 0,
    }

    for (const memberInput of input.members) {
      try {
        // Check if exists
        const emailHash = md5Hash(memberInput.emailAddress)
        const existingKey = `${this.EMAIL_INDEX}${listId}:${emailHash}`
        const existing = await this.storage.get<string>(existingKey)

        if (existing && input.updateExisting) {
          const updated = await this.update(listId, emailHash, memberInput)
          result.updatedMembers.push(updated)
          result.totalUpdated++
        } else if (!existing) {
          const created = await this.add(listId, memberInput)
          result.newMembers.push(created)
          result.totalCreated++
        } else {
          result.errors.push({
            emailAddress: memberInput.emailAddress,
            error: 'Member already exists',
            errorCode: 'ERROR_MEMBER_EXISTS',
          })
          result.errorCount++
        }
      } catch (error) {
        result.errors.push({
          emailAddress: memberInput.emailAddress,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorCode: 'ERROR_GENERIC',
        })
        result.errorCount++
      }
    }

    return result
  }

  async addTags(listId: string, memberId: string, tags: string[]): Promise<void> {
    const member = await this.get(listId, memberId)
    const existingTags = new Set(member.tags)
    for (const tag of tags) {
      existingTags.add(tag)
    }
    member.tags = Array.from(existingTags)
    member.tagsCount = member.tags.length
    member.lastChanged = now()
    await this.storage.put(`${this.PREFIX}${listId}:${memberId}`, member)
  }

  async removeTags(listId: string, memberId: string, tags: string[]): Promise<void> {
    const member = await this.get(listId, memberId)
    const tagsToRemove = new Set(tags)
    member.tags = member.tags.filter((t) => !tagsToRemove.has(t))
    member.tagsCount = member.tags.length
    member.lastChanged = now()
    await this.storage.put(`${this.PREFIX}${listId}:${memberId}`, member)
  }
}

// =============================================================================
// Segments API
// =============================================================================

export class SegmentsApi {
  private storage: ListsStorage
  private readonly PREFIX = 'segment:'
  private readonly STATIC_PREFIX = 'segment_static:'

  constructor(storage: ListsStorage) {
    this.storage = storage
  }

  async create(listId: string, input: CreateSegmentInput): Promise<Segment> {
    const id = generateId('seg')
    const timestamp = now()

    const segment: Segment = {
      id,
      name: input.name,
      memberCount: input.staticSegment?.length ?? 0,
      type: input.staticSegment ? 'static' : input.options ? 'saved' : 'static',
      createdAt: timestamp,
      updatedAt: timestamp,
      options: input.options,
      listId,
    }

    await this.storage.put(`${this.PREFIX}${listId}:${id}`, segment)

    if (input.staticSegment) {
      await this.storage.put(`${this.STATIC_PREFIX}${listId}:${id}`, input.staticSegment)
    }

    return segment
  }

  async get(listId: string, segmentId: string): Promise<Segment> {
    const segment = await this.storage.get<Segment>(`${this.PREFIX}${listId}:${segmentId}`)
    if (!segment) {
      throw new MailchimpError(
        'Resource Not Found',
        404,
        'The requested segment could not be found.'
      )
    }
    return segment
  }

  async update(listId: string, segmentId: string, input: UpdateSegmentInput): Promise<Segment> {
    const segment = await this.get(listId, segmentId)

    const updated: Segment = {
      ...segment,
      name: input.name ?? segment.name,
      options: input.options ?? segment.options,
      updatedAt: now(),
    }

    if (input.staticSegment !== undefined) {
      updated.memberCount = input.staticSegment.length
      await this.storage.put(`${this.STATIC_PREFIX}${listId}:${segmentId}`, input.staticSegment)
    }

    await this.storage.put(`${this.PREFIX}${listId}:${segmentId}`, updated)
    return updated
  }

  async delete(listId: string, segmentId: string): Promise<void> {
    await this.get(listId, segmentId) // Verify exists
    await this.storage.delete(`${this.PREFIX}${listId}:${segmentId}`)
    await this.storage.delete(`${this.STATIC_PREFIX}${listId}:${segmentId}`)
  }

  async list(listId: string, options?: { count?: number; offset?: number }): Promise<ListSegmentsResult> {
    const segmentsMap = await this.storage.list({ prefix: `${this.PREFIX}${listId}:` })
    let segments: Segment[] = []

    for (const value of segmentsMap.values()) {
      segments.push(value as Segment)
    }

    segments.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

    const totalItems = segments.length
    const offset = options?.offset ?? 0
    const count = options?.count ?? 10
    segments = segments.slice(offset, offset + count)

    return { segments, listId, totalItems }
  }

  async addMembers(listId: string, segmentId: string, emails: string[]): Promise<void> {
    const segment = await this.get(listId, segmentId)
    const staticMembers = await this.storage.get<string[]>(`${this.STATIC_PREFIX}${listId}:${segmentId}`) ?? []
    const memberSet = new Set(staticMembers)

    for (const email of emails) {
      memberSet.add(email)
    }

    const updated = Array.from(memberSet)
    await this.storage.put(`${this.STATIC_PREFIX}${listId}:${segmentId}`, updated)

    segment.memberCount = updated.length
    segment.updatedAt = now()
    await this.storage.put(`${this.PREFIX}${listId}:${segmentId}`, segment)
  }

  async removeMembers(listId: string, segmentId: string, emails: string[]): Promise<void> {
    const segment = await this.get(listId, segmentId)
    const staticMembers = await this.storage.get<string[]>(`${this.STATIC_PREFIX}${listId}:${segmentId}`) ?? []
    const removeSet = new Set(emails)

    const updated = staticMembers.filter((e) => !removeSet.has(e))
    await this.storage.put(`${this.STATIC_PREFIX}${listId}:${segmentId}`, updated)

    segment.memberCount = updated.length
    segment.updatedAt = now()
    await this.storage.put(`${this.PREFIX}${listId}:${segmentId}`, segment)
  }
}

// =============================================================================
// Tags API
// =============================================================================

export class TagsApi {
  private storage: ListsStorage
  private readonly PREFIX = 'tag:'

  constructor(storage: ListsStorage) {
    this.storage = storage
  }

  async create(listId: string, input: CreateTagInput): Promise<Tag> {
    const id = generateId('tag')
    const timestamp = now()

    const tag: Tag = {
      id,
      name: input.name,
      memberCount: 0,
      dateAdded: timestamp,
    }

    await this.storage.put(`${this.PREFIX}${listId}:${id}`, tag)
    return tag
  }

  async get(listId: string, tagId: string): Promise<Tag> {
    const tag = await this.storage.get<Tag>(`${this.PREFIX}${listId}:${tagId}`)
    if (!tag) {
      throw new MailchimpError(
        'Resource Not Found',
        404,
        'The requested tag could not be found.'
      )
    }
    return tag
  }

  async delete(listId: string, tagId: string): Promise<void> {
    await this.get(listId, tagId) // Verify exists
    await this.storage.delete(`${this.PREFIX}${listId}:${tagId}`)
  }

  async list(listId: string): Promise<ListTagsResult> {
    const tagsMap = await this.storage.list({ prefix: `${this.PREFIX}${listId}:` })
    const tags: Tag[] = []

    for (const value of tagsMap.values()) {
      tags.push(value as Tag)
    }

    tags.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded))

    return { tags, totalItems: tags.length }
  }
}

// =============================================================================
// Webhooks API
// =============================================================================

export class WebhooksApi {
  private storage: ListsStorage
  private readonly PREFIX = 'webhook:'

  constructor(storage: ListsStorage) {
    this.storage = storage
  }

  async create(listId: string, input: CreateWebhookInput): Promise<Webhook> {
    const id = generateId('wh')

    const webhook: Webhook = {
      id,
      url: input.url,
      events: input.events,
      sources: input.sources,
      listId,
    }

    await this.storage.put(`${this.PREFIX}${listId}:${id}`, webhook)
    return webhook
  }

  async get(listId: string, webhookId: string): Promise<Webhook> {
    const webhook = await this.storage.get<Webhook>(`${this.PREFIX}${listId}:${webhookId}`)
    if (!webhook) {
      throw new MailchimpError(
        'Resource Not Found',
        404,
        'The requested webhook could not be found.'
      )
    }
    return webhook
  }

  async update(listId: string, webhookId: string, input: UpdateWebhookInput): Promise<Webhook> {
    const webhook = await this.get(listId, webhookId)

    const updated: Webhook = {
      ...webhook,
      url: input.url ?? webhook.url,
      events: input.events ?? webhook.events,
      sources: input.sources ?? webhook.sources,
    }

    await this.storage.put(`${this.PREFIX}${listId}:${webhookId}`, updated)
    return updated
  }

  async delete(listId: string, webhookId: string): Promise<void> {
    await this.get(listId, webhookId) // Verify exists
    await this.storage.delete(`${this.PREFIX}${listId}:${webhookId}`)
  }

  async list(listId: string): Promise<ListWebhooksResult> {
    const webhooksMap = await this.storage.list({ prefix: `${this.PREFIX}${listId}:` })
    const webhooks: Webhook[] = []

    for (const value of webhooksMap.values()) {
      webhooks.push(value as Webhook)
    }

    return { webhooks, listId, totalItems: webhooks.length }
  }
}

// =============================================================================
// Main MailchimpLists Class
// =============================================================================

export class MailchimpLists {
  private storage: ListsStorage
  private readonly PREFIX = 'list:'

  readonly members: MembersApi
  readonly segments: SegmentsApi
  readonly tags: TagsApi
  readonly webhooks: WebhooksApi

  constructor(storage: ListsStorage) {
    this.storage = storage

    // Create APIs with proper bindings
    const getList = async (): Promise<List> => {
      // This is a placeholder - the actual listId is passed to member methods
      throw new Error('getList called without context')
    }

    const updateStats = async (listId: string, updates: Partial<ListStats>): Promise<void> => {
      const list = await this.get(listId)
      list.stats = { ...list.stats, ...updates }
      await this.storage.put(`${this.PREFIX}${listId}`, list)
    }

    this.members = new MembersApi(
      storage,
      getList,
      updateStats
    )
    this.segments = new SegmentsApi(storage)
    this.tags = new TagsApi(storage)
    this.webhooks = new WebhooksApi(storage)

    // Override members.add to properly update list context
    const originalAdd = this.members.add.bind(this.members)
    this.members.add = async (listId: string, input: AddMemberInput): Promise<Member> => {
      // Verify list exists first
      await this.get(listId)
      return originalAdd(listId, input)
    }
  }

  async create(input: CreateListInput): Promise<List> {
    const id = generateId('list')
    const timestamp = now()

    const list: List = {
      id,
      webId: Math.floor(Math.random() * 1000000000),
      name: input.name,
      contact: input.contact,
      permissionReminder: input.permissionReminder,
      useArchiveBar: input.useArchiveBar ?? true,
      campaignDefaults: input.campaignDefaults,
      notifyOnSubscribe: input.notifyOnSubscribe ?? '',
      notifyOnUnsubscribe: input.notifyOnUnsubscribe ?? '',
      dateCreated: timestamp,
      listRating: 0,
      emailTypeOption: input.emailTypeOption ?? false,
      subscribeUrlShort: `https://eepurl.com/${id.substring(5, 12)}`,
      subscribeUrlLong: `https://example.us1.list-manage.com/subscribe?u=${id}`,
      beamerAddress: `${id}@incoming.mailchimp.com`,
      visibility: input.visibility ?? 'pub',
      doubleOptin: input.doubleOptin ?? false,
      hasWelcome: false,
      marketingPermissions: input.marketingPermissions ?? false,
      modules: [],
      stats: {
        memberCount: 0,
        unsubscribeCount: 0,
        cleanedCount: 0,
        memberCountSinceSend: 0,
        unsubscribeCountSinceSend: 0,
        cleanedCountSinceSend: 0,
        campaignCount: 0,
        mergeFieldCount: 0,
        avgSubRate: 0,
        avgUnsubRate: 0,
        targetSubRate: 0,
        openRate: 0,
        clickRate: 0,
      },
    }

    await this.storage.put(`${this.PREFIX}${id}`, list)
    return list
  }

  async get(listId: string): Promise<List> {
    const list = await this.storage.get<List>(`${this.PREFIX}${listId}`)
    if (!list) {
      throw new MailchimpError(
        'Resource Not Found',
        404,
        'The requested resource could not be found.'
      )
    }
    return list
  }

  async update(listId: string, input: UpdateListInput): Promise<List> {
    const list = await this.get(listId)

    const updated: List = {
      ...list,
      name: input.name ?? list.name,
      contact: input.contact ? { ...list.contact, ...input.contact } : list.contact,
      permissionReminder: input.permissionReminder ?? list.permissionReminder,
      campaignDefaults: input.campaignDefaults ?? list.campaignDefaults,
      useArchiveBar: input.useArchiveBar ?? list.useArchiveBar,
      notifyOnSubscribe: input.notifyOnSubscribe ?? list.notifyOnSubscribe,
      notifyOnUnsubscribe: input.notifyOnUnsubscribe ?? list.notifyOnUnsubscribe,
      emailTypeOption: input.emailTypeOption ?? list.emailTypeOption,
      visibility: input.visibility ?? list.visibility,
      doubleOptin: input.doubleOptin ?? list.doubleOptin,
      marketingPermissions: input.marketingPermissions ?? list.marketingPermissions,
    }

    await this.storage.put(`${this.PREFIX}${listId}`, updated)
    return updated
  }

  async delete(listId: string): Promise<void> {
    await this.get(listId) // Verify exists
    await this.storage.delete(`${this.PREFIX}${listId}`)
  }

  async list(options?: { count?: number; offset?: number }): Promise<ListListResult> {
    const listsMap = await this.storage.list({ prefix: this.PREFIX })
    let lists: List[] = []

    for (const value of listsMap.values()) {
      lists.push(value as List)
    }

    lists.sort((a, b) => b.dateCreated.localeCompare(a.dateCreated))

    const totalItems = lists.length
    const offset = options?.offset ?? 0
    const count = options?.count ?? 10
    lists = lists.slice(offset, offset + count)

    return { lists, totalItems }
  }
}

export default MailchimpLists
