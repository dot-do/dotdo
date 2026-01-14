/**
 * @dotdo/hubspot/marketing - HubSpot Marketing Hub Compatibility Layer
 *
 * Drop-in replacement for HubSpot Marketing Hub APIs with edge compatibility.
 * Provides marketing emails, campaigns, events, and list management.
 *
 * @example
 * ```typescript
 * import { HubSpotMarketing } from '@dotdo/hubspot/marketing'
 *
 * const marketing = new HubSpotMarketing(storage)
 *
 * // Create an email template
 * const email = await marketing.emails.create({
 *   name: 'Welcome Email',
 *   subject: 'Welcome to Our Service',
 *   body: '<html>...</html>',
 *   type: 'marketing',
 * })
 *
 * // Create a campaign
 * const campaign = await marketing.campaigns.create({
 *   name: 'Q1 Launch',
 *   type: 'email',
 *   status: 'draft',
 * })
 *
 * // Add email to campaign
 * await marketing.campaigns.addAsset(campaign.id, {
 *   type: 'email',
 *   assetId: email.id,
 * })
 * ```
 *
 * @module @dotdo/hubspot/marketing
 */

// =============================================================================
// Types - Marketing Emails
// =============================================================================

/**
 * Email type (marketing vs transactional)
 */
export type MarketingEmailType = 'marketing' | 'transactional' | 'automated' | 'blog_email' | 'rss_email'

/**
 * Email state
 */
export type MarketingEmailState = 'draft' | 'scheduled' | 'published' | 'archived' | 'processing' | 'error'

/**
 * Email content type
 */
export type EmailContentType = 'html' | 'drag_drop' | 'custom_template' | 'classic'

/**
 * Marketing email definition
 */
export interface MarketingEmail {
  id: string
  name: string
  subject: string
  previewText?: string
  fromName: string
  fromEmail: string
  replyTo?: string
  body: string
  bodyPlainText?: string
  type: MarketingEmailType
  contentType: EmailContentType
  state: MarketingEmailState
  templateId?: string
  campaignId?: string
  listIds?: string[]
  excludeListIds?: string[]
  publishedAt?: string
  scheduledAt?: string
  abTest?: ABTestConfig
  settings: EmailSettings
  analytics?: EmailAnalytics
  createdAt: string
  updatedAt: string
  archived: boolean
  archivedAt?: string
}

/**
 * A/B test configuration
 */
export interface ABTestConfig {
  enabled: boolean
  testType: 'subject' | 'from_name' | 'content' | 'send_time'
  variantA: ABTestVariant
  variantB: ABTestVariant
  winnerCriteria: 'open_rate' | 'click_rate' | 'conversion_rate'
  testDuration: number // hours
  sampleSize: number // percentage (0-50)
  winnerId?: string
  winnerDeclaredAt?: string
}

/**
 * A/B test variant
 */
export interface ABTestVariant {
  id: string
  name: string
  subject?: string
  fromName?: string
  body?: string
}

/**
 * Email settings
 */
export interface EmailSettings {
  trackOpens: boolean
  trackClicks: boolean
  trackReplies: boolean
  subscriptionType?: string
  unsubscribeGroupId?: string
  sendOnBehalfOf?: string
  googleAnalytics?: {
    enabled: boolean
    campaign?: string
    source?: string
    medium?: string
  }
  ipPool?: string
}

/**
 * Email analytics
 */
export interface EmailAnalytics {
  sent: number
  delivered: number
  bounced: number
  opens: number
  uniqueOpens: number
  clicks: number
  uniqueClicks: number
  unsubscribes: number
  spamReports: number
  replies: number
  conversions: number
  revenue: number
  openRate: number
  clickRate: number
  bounceRate: number
  unsubscribeRate: number
}

/**
 * Create email input
 */
export interface CreateEmailInput {
  name: string
  subject: string
  previewText?: string
  fromName?: string
  fromEmail?: string
  replyTo?: string
  body: string
  bodyPlainText?: string
  type?: MarketingEmailType
  contentType?: EmailContentType
  templateId?: string
  campaignId?: string
  listIds?: string[]
  excludeListIds?: string[]
  abTest?: Partial<ABTestConfig>
  settings?: Partial<EmailSettings>
}

/**
 * Update email input
 */
export interface UpdateEmailInput {
  name?: string
  subject?: string
  previewText?: string
  fromName?: string
  fromEmail?: string
  replyTo?: string
  body?: string
  bodyPlainText?: string
  listIds?: string[]
  excludeListIds?: string[]
  settings?: Partial<EmailSettings>
}

/**
 * Schedule email input
 */
export interface ScheduleEmailInput {
  scheduledAt: string
  timezone?: string
}

/**
 * Send email input
 */
export interface SendEmailInput {
  contactIds?: string[]
  listIds?: string[]
  sendNow?: boolean
}

// =============================================================================
// Types - Marketing Campaigns
// =============================================================================

/**
 * Campaign type
 */
export type CampaignType = 'email' | 'content' | 'social' | 'ads' | 'events' | 'multi_channel'

/**
 * Campaign status
 */
export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'archived'

/**
 * Campaign asset type
 */
export type CampaignAssetType = 'email' | 'landing_page' | 'form' | 'cta' | 'blog_post' | 'social_post' | 'ad' | 'workflow'

/**
 * Campaign definition
 */
export interface Campaign {
  id: string
  name: string
  description?: string
  type: CampaignType
  status: CampaignStatus
  startDate?: string
  endDate?: string
  budget?: CampaignBudget
  goals?: CampaignGoals
  assets: CampaignAsset[]
  audiences: CampaignAudience[]
  analytics?: CampaignAnalytics
  settings: CampaignSettings
  createdAt: string
  updatedAt: string
  archived: boolean
  archivedAt?: string
}

/**
 * Campaign budget
 */
export interface CampaignBudget {
  total: number
  currency: string
  spent: number
  remaining: number
  breakdown?: Record<CampaignAssetType, number>
}

/**
 * Campaign goals
 */
export interface CampaignGoals {
  leads?: number
  customers?: number
  revenue?: number
  impressions?: number
  clicks?: number
  conversions?: number
  customGoals?: Array<{
    name: string
    target: number
    current: number
    metric: string
  }>
}

/**
 * Campaign asset reference
 */
export interface CampaignAsset {
  id: string
  type: CampaignAssetType
  assetId: string
  name: string
  status: 'active' | 'inactive' | 'completed'
  addedAt: string
  metrics?: Record<string, number>
}

/**
 * Campaign audience
 */
export interface CampaignAudience {
  id: string
  type: 'list' | 'segment' | 'all_contacts' | 'custom'
  audienceId?: string
  name: string
  size?: number
  filters?: AudienceFilter[]
}

/**
 * Audience filter
 */
export interface AudienceFilter {
  property: string
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'in' | 'not_in' | 'is_known' | 'is_unknown'
  value?: unknown
}

/**
 * Campaign analytics
 */
export interface CampaignAnalytics {
  impressions: number
  reach: number
  clicks: number
  uniqueClicks: number
  conversions: number
  conversionRate: number
  leads: number
  customers: number
  revenue: number
  roi: number
  costPerLead: number
  costPerCustomer: number
  engagementRate: number
  byChannel: Record<CampaignAssetType, {
    impressions: number
    clicks: number
    conversions: number
    spend: number
  }>
  byDate: Array<{
    date: string
    impressions: number
    clicks: number
    conversions: number
  }>
}

/**
 * Campaign settings
 */
export interface CampaignSettings {
  utmCampaign?: string
  utmSource?: string
  utmMedium?: string
  trackingDomain?: string
  conversionWindow?: number // days
  attributionModel?: 'first_touch' | 'last_touch' | 'linear' | 'time_decay' | 'position_based'
  notifications?: {
    onComplete: boolean
    onMilestone: boolean
    recipients: string[]
  }
}

/**
 * Create campaign input
 */
export interface CreateCampaignInput {
  name: string
  description?: string
  type: CampaignType
  startDate?: string
  endDate?: string
  budget?: Partial<CampaignBudget>
  goals?: Partial<CampaignGoals>
  settings?: Partial<CampaignSettings>
}

/**
 * Update campaign input
 */
export interface UpdateCampaignInput {
  name?: string
  description?: string
  startDate?: string
  endDate?: string
  budget?: Partial<CampaignBudget>
  goals?: Partial<CampaignGoals>
  settings?: Partial<CampaignSettings>
}

/**
 * Add asset input
 */
export interface AddAssetInput {
  type: CampaignAssetType
  assetId: string
  name?: string
}

// =============================================================================
// Types - Marketing Events
// =============================================================================

/**
 * Marketing event type
 */
export type MarketingEventType = 'webinar' | 'conference' | 'meetup' | 'trade_show' | 'workshop' | 'virtual_event' | 'in_person' | 'hybrid'

/**
 * Event status
 */
export type EventStatus = 'draft' | 'published' | 'live' | 'completed' | 'cancelled'

/**
 * Event registration status
 */
export type RegistrationStatus = 'registered' | 'attended' | 'no_show' | 'cancelled' | 'waitlisted'

/**
 * Marketing event definition
 */
export interface MarketingEvent {
  id: string
  name: string
  description?: string
  type: MarketingEventType
  status: EventStatus
  startTime: string
  endTime: string
  timezone: string
  location?: EventLocation
  registrationUrl?: string
  capacity?: number
  registrations: EventRegistration[]
  campaignId?: string
  externalId?: string
  externalProvider?: 'zoom' | 'goto_webinar' | 'webex' | 'teams' | 'custom'
  settings: EventSettings
  analytics?: EventAnalytics
  createdAt: string
  updatedAt: string
  archived: boolean
}

/**
 * Event location
 */
export interface EventLocation {
  type: 'virtual' | 'in_person' | 'hybrid'
  name?: string
  address?: string
  city?: string
  state?: string
  country?: string
  postalCode?: string
  virtualUrl?: string
  virtualPlatform?: string
}

/**
 * Event registration
 */
export interface EventRegistration {
  id: string
  eventId: string
  contactId: string
  status: RegistrationStatus
  registeredAt: string
  attendedAt?: string
  cancelledAt?: string
  source?: string
  customFields?: Record<string, unknown>
}

/**
 * Event settings
 */
export interface EventSettings {
  requireApproval: boolean
  enableWaitlist: boolean
  sendConfirmation: boolean
  sendReminders: boolean
  reminderSchedule?: Array<{
    before: number // hours
    emailId?: string
  }>
  registrationFields?: Array<{
    name: string
    label: string
    required: boolean
    type: 'text' | 'email' | 'phone' | 'select' | 'checkbox'
    options?: string[]
  }>
}

/**
 * Event analytics
 */
export interface EventAnalytics {
  totalRegistrations: number
  totalAttendees: number
  noShows: number
  cancellations: number
  attendanceRate: number
  registrationsBySource: Record<string, number>
  registrationsByDate: Array<{
    date: string
    count: number
  }>
}

/**
 * Create event input
 */
export interface CreateEventInput {
  name: string
  description?: string
  type: MarketingEventType
  startTime: string
  endTime: string
  timezone?: string
  location?: Partial<EventLocation>
  registrationUrl?: string
  capacity?: number
  campaignId?: string
  externalId?: string
  externalProvider?: MarketingEvent['externalProvider']
  settings?: Partial<EventSettings>
}

/**
 * Update event input
 */
export interface UpdateEventInput {
  name?: string
  description?: string
  startTime?: string
  endTime?: string
  timezone?: string
  location?: Partial<EventLocation>
  registrationUrl?: string
  capacity?: number
  settings?: Partial<EventSettings>
}

/**
 * Register contact input
 */
export interface RegisterContactInput {
  contactId: string
  source?: string
  customFields?: Record<string, unknown>
}

// =============================================================================
// Types - Marketing Lists
// =============================================================================

/**
 * List type
 */
export type MarketingListType = 'static' | 'dynamic'

/**
 * List object type
 */
export type ListObjectType = 'contacts' | 'companies'

/**
 * Marketing list definition
 */
export interface MarketingList {
  id: string
  name: string
  description?: string
  type: MarketingListType
  objectType: ListObjectType
  filters?: ListFilter[]
  memberCount: number
  portalId?: number
  createdAt: string
  updatedAt: string
  archived: boolean
  archivedAt?: string
}

/**
 * List filter for dynamic lists
 */
export interface ListFilter {
  filterType: 'property' | 'event' | 'form_submission' | 'list_membership' | 'page_view' | 'email_activity'
  property?: string
  operator: 'eq' | 'neq' | 'contains' | 'not_contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_known' | 'is_unknown' | 'in' | 'not_in'
  value?: unknown
  values?: unknown[]
  and?: ListFilter[]
  or?: ListFilter[]
}

/**
 * List member
 */
export interface ListMember {
  id: string
  objectId: string
  objectType: ListObjectType
  addedAt: string
  addedBy?: string
  source?: 'manual' | 'import' | 'workflow' | 'api' | 'form' | 'dynamic'
}

/**
 * Create list input
 */
export interface CreateListInput {
  name: string
  description?: string
  type?: MarketingListType
  objectType?: ListObjectType
  filters?: ListFilter[]
}

/**
 * Update list input
 */
export interface UpdateListInput {
  name?: string
  description?: string
  filters?: ListFilter[]
}

/**
 * Add members input
 */
export interface AddMembersInput {
  objectIds: string[]
}

// =============================================================================
// Types - Storage & Configuration
// =============================================================================

/**
 * Storage interface for marketing data
 */
export interface MarketingStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: { prefix?: string; limit?: number }): Promise<Map<string, unknown>>
}

/**
 * List result type
 */
export interface ListResult<T> {
  results: T[]
  paging?: {
    next?: { after: string }
  }
}

// =============================================================================
// Error Class
// =============================================================================

export class HubSpotMarketingError extends Error {
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
    this.name = 'HubSpotMarketingError'
    this.category = category
    this.statusCode = statusCode
    this.correlationId = generateId('correlation')
    this.context = context
  }
}

// =============================================================================
// Utilities
// =============================================================================

function generateId(prefix: string = 'mkt'): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

function now(): string {
  return new Date().toISOString()
}

// =============================================================================
// Marketing Emails API
// =============================================================================

/**
 * Marketing Emails API for email template management and sending
 */
export class MarketingEmailsApi {
  private storage: MarketingStorage
  private readonly PREFIX = 'email:'

  constructor(storage: MarketingStorage) {
    this.storage = storage
  }

  /**
   * Create a new marketing email
   */
  async create(input: CreateEmailInput): Promise<MarketingEmail> {
    const id = generateId('email')
    const timestamp = now()

    const email: MarketingEmail = {
      id,
      name: input.name,
      subject: input.subject,
      previewText: input.previewText,
      fromName: input.fromName ?? 'Your Company',
      fromEmail: input.fromEmail ?? 'noreply@example.com',
      replyTo: input.replyTo,
      body: input.body,
      bodyPlainText: input.bodyPlainText,
      type: input.type ?? 'marketing',
      contentType: input.contentType ?? 'html',
      state: 'draft',
      templateId: input.templateId,
      campaignId: input.campaignId,
      listIds: input.listIds ?? [],
      excludeListIds: input.excludeListIds ?? [],
      settings: {
        trackOpens: true,
        trackClicks: true,
        trackReplies: false,
        ...input.settings,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    }

    if (input.abTest?.enabled) {
      email.abTest = {
        enabled: true,
        testType: input.abTest.testType ?? 'subject',
        variantA: input.abTest.variantA ?? { id: generateId('variant'), name: 'Variant A' },
        variantB: input.abTest.variantB ?? { id: generateId('variant'), name: 'Variant B' },
        winnerCriteria: input.abTest.winnerCriteria ?? 'open_rate',
        testDuration: input.abTest.testDuration ?? 4,
        sampleSize: input.abTest.sampleSize ?? 15,
      }
    }

    await this.storage.put(`${this.PREFIX}${id}`, email)
    return email
  }

  /**
   * Get an email by ID
   */
  async getById(emailId: string): Promise<MarketingEmail> {
    const email = await this.storage.get<MarketingEmail>(`${this.PREFIX}${emailId}`)
    if (!email || email.archived) {
      throw new HubSpotMarketingError(
        `Email not found: ${emailId}`,
        'EMAIL_NOT_FOUND',
        404
      )
    }
    return email
  }

  /**
   * Update an email
   */
  async update(emailId: string, input: UpdateEmailInput): Promise<MarketingEmail> {
    const email = await this.getById(emailId)

    if (email.state === 'published') {
      throw new HubSpotMarketingError(
        'Cannot update published email',
        'EMAIL_PUBLISHED',
        400
      )
    }

    const updatedEmail: MarketingEmail = {
      ...email,
      ...input,
      settings: {
        ...email.settings,
        ...input.settings,
      },
      updatedAt: now(),
    }

    await this.storage.put(`${this.PREFIX}${emailId}`, updatedEmail)
    return updatedEmail
  }

  /**
   * Delete (archive) an email
   */
  async archive(emailId: string): Promise<void> {
    const email = await this.getById(emailId)
    const timestamp = now()

    const archivedEmail: MarketingEmail = {
      ...email,
      archived: true,
      archivedAt: timestamp,
      state: 'archived',
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX}${emailId}`, archivedEmail)
  }

  /**
   * List all emails
   */
  async list(options?: {
    limit?: number
    after?: string
    type?: MarketingEmailType
    state?: MarketingEmailState
  }): Promise<ListResult<MarketingEmail>> {
    const emailsMap = await this.storage.list({ prefix: this.PREFIX })
    const emails: MarketingEmail[] = []

    for (const value of emailsMap.values()) {
      const email = value as MarketingEmail
      if (email.archived) continue
      if (options?.type && email.type !== options.type) continue
      if (options?.state && email.state !== options.state) continue
      emails.push(email)
    }

    emails.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

    const limit = options?.limit ?? 100
    let startIndex = 0
    if (options?.after) {
      const afterIndex = emails.findIndex((e) => e.id === options.after)
      if (afterIndex !== -1) startIndex = afterIndex + 1
    }

    const paged = emails.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < emails.length

    return {
      results: paged,
      paging: hasMore ? { next: { after: paged[paged.length - 1]?.id ?? '' } } : undefined,
    }
  }

  /**
   * Schedule an email for sending
   */
  async schedule(emailId: string, input: ScheduleEmailInput): Promise<MarketingEmail> {
    const email = await this.getById(emailId)

    if (email.state !== 'draft') {
      throw new HubSpotMarketingError(
        `Email must be in draft state to schedule. Current state: ${email.state}`,
        'INVALID_STATE',
        400
      )
    }

    const scheduledEmail: MarketingEmail = {
      ...email,
      state: 'scheduled',
      scheduledAt: input.scheduledAt,
      updatedAt: now(),
    }

    await this.storage.put(`${this.PREFIX}${emailId}`, scheduledEmail)
    return scheduledEmail
  }

  /**
   * Publish/send an email immediately
   */
  async publish(emailId: string, input?: SendEmailInput): Promise<MarketingEmail> {
    const email = await this.getById(emailId)

    if (email.state !== 'draft' && email.state !== 'scheduled') {
      throw new HubSpotMarketingError(
        `Email must be in draft or scheduled state to publish. Current state: ${email.state}`,
        'INVALID_STATE',
        400
      )
    }

    // Update list targeting if provided
    let listIds = email.listIds
    if (input?.listIds) {
      listIds = input.listIds
    }

    const publishedEmail: MarketingEmail = {
      ...email,
      state: 'published',
      publishedAt: now(),
      listIds,
      updatedAt: now(),
      analytics: {
        sent: 0,
        delivered: 0,
        bounced: 0,
        opens: 0,
        uniqueOpens: 0,
        clicks: 0,
        uniqueClicks: 0,
        unsubscribes: 0,
        spamReports: 0,
        replies: 0,
        conversions: 0,
        revenue: 0,
        openRate: 0,
        clickRate: 0,
        bounceRate: 0,
        unsubscribeRate: 0,
      },
    }

    await this.storage.put(`${this.PREFIX}${emailId}`, publishedEmail)
    return publishedEmail
  }

  /**
   * Cancel a scheduled email
   */
  async cancel(emailId: string): Promise<MarketingEmail> {
    const email = await this.getById(emailId)

    if (email.state !== 'scheduled') {
      throw new HubSpotMarketingError(
        `Email must be in scheduled state to cancel. Current state: ${email.state}`,
        'INVALID_STATE',
        400
      )
    }

    const cancelledEmail: MarketingEmail = {
      ...email,
      state: 'draft',
      scheduledAt: undefined,
      updatedAt: now(),
    }

    await this.storage.put(`${this.PREFIX}${emailId}`, cancelledEmail)
    return cancelledEmail
  }

  /**
   * Clone an email
   */
  async clone(emailId: string, newName: string): Promise<MarketingEmail> {
    const email = await this.getById(emailId)

    return this.create({
      name: newName,
      subject: email.subject,
      previewText: email.previewText,
      fromName: email.fromName,
      fromEmail: email.fromEmail,
      replyTo: email.replyTo,
      body: email.body,
      bodyPlainText: email.bodyPlainText,
      type: email.type,
      contentType: email.contentType,
      templateId: email.templateId,
      settings: email.settings,
    })
  }

  /**
   * Get email analytics
   */
  async getAnalytics(emailId: string): Promise<EmailAnalytics> {
    const email = await this.getById(emailId)

    if (!email.analytics) {
      return {
        sent: 0,
        delivered: 0,
        bounced: 0,
        opens: 0,
        uniqueOpens: 0,
        clicks: 0,
        uniqueClicks: 0,
        unsubscribes: 0,
        spamReports: 0,
        replies: 0,
        conversions: 0,
        revenue: 0,
        openRate: 0,
        clickRate: 0,
        bounceRate: 0,
        unsubscribeRate: 0,
      }
    }

    return email.analytics
  }

  /**
   * Update email analytics (for tracking)
   */
  async updateAnalytics(emailId: string, updates: Partial<EmailAnalytics>): Promise<EmailAnalytics> {
    const email = await this.getById(emailId)

    const analytics: EmailAnalytics = {
      ...email.analytics ?? {
        sent: 0,
        delivered: 0,
        bounced: 0,
        opens: 0,
        uniqueOpens: 0,
        clicks: 0,
        uniqueClicks: 0,
        unsubscribes: 0,
        spamReports: 0,
        replies: 0,
        conversions: 0,
        revenue: 0,
        openRate: 0,
        clickRate: 0,
        bounceRate: 0,
        unsubscribeRate: 0,
      },
      ...updates,
    }

    // Recalculate rates
    if (analytics.delivered > 0) {
      analytics.openRate = (analytics.uniqueOpens / analytics.delivered) * 100
      analytics.clickRate = (analytics.uniqueClicks / analytics.delivered) * 100
    }
    if (analytics.sent > 0) {
      analytics.bounceRate = (analytics.bounced / analytics.sent) * 100
      analytics.unsubscribeRate = (analytics.unsubscribes / analytics.delivered) * 100
    }

    const updatedEmail: MarketingEmail = {
      ...email,
      analytics,
      updatedAt: now(),
    }

    await this.storage.put(`${this.PREFIX}${emailId}`, updatedEmail)
    return analytics
  }
}

// =============================================================================
// Marketing Campaigns API
// =============================================================================

/**
 * Marketing Campaigns API for campaign management
 */
export class MarketingCampaignsApi {
  private storage: MarketingStorage
  private readonly PREFIX = 'campaign:'

  constructor(storage: MarketingStorage) {
    this.storage = storage
  }

  /**
   * Create a new campaign
   */
  async create(input: CreateCampaignInput): Promise<Campaign> {
    const id = generateId('campaign')
    const timestamp = now()

    const campaign: Campaign = {
      id,
      name: input.name,
      description: input.description,
      type: input.type,
      status: 'draft',
      startDate: input.startDate,
      endDate: input.endDate,
      budget: input.budget ? {
        total: input.budget.total ?? 0,
        currency: input.budget.currency ?? 'USD',
        spent: input.budget.spent ?? 0,
        remaining: input.budget.total ?? 0,
      } : undefined,
      goals: input.goals,
      assets: [],
      audiences: [],
      settings: {
        attributionModel: 'last_touch',
        conversionWindow: 30,
        ...input.settings,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    }

    await this.storage.put(`${this.PREFIX}${id}`, campaign)
    return campaign
  }

  /**
   * Get a campaign by ID
   */
  async getById(campaignId: string): Promise<Campaign> {
    const campaign = await this.storage.get<Campaign>(`${this.PREFIX}${campaignId}`)
    if (!campaign || campaign.archived) {
      throw new HubSpotMarketingError(
        `Campaign not found: ${campaignId}`,
        'CAMPAIGN_NOT_FOUND',
        404
      )
    }
    return campaign
  }

  /**
   * Update a campaign
   */
  async update(campaignId: string, input: UpdateCampaignInput): Promise<Campaign> {
    const campaign = await this.getById(campaignId)

    const updatedCampaign: Campaign = {
      ...campaign,
      ...input,
      budget: input.budget ? {
        ...campaign.budget ?? { total: 0, currency: 'USD', spent: 0, remaining: 0 },
        ...input.budget,
      } : campaign.budget,
      goals: input.goals ? {
        ...campaign.goals,
        ...input.goals,
      } : campaign.goals,
      settings: {
        ...campaign.settings,
        ...input.settings,
      },
      updatedAt: now(),
    }

    await this.storage.put(`${this.PREFIX}${campaignId}`, updatedCampaign)
    return updatedCampaign
  }

  /**
   * Delete (archive) a campaign
   */
  async archive(campaignId: string): Promise<void> {
    const campaign = await this.getById(campaignId)
    const timestamp = now()

    const archivedCampaign: Campaign = {
      ...campaign,
      archived: true,
      archivedAt: timestamp,
      status: 'archived',
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX}${campaignId}`, archivedCampaign)
  }

  /**
   * List all campaigns
   */
  async list(options?: {
    limit?: number
    after?: string
    type?: CampaignType
    status?: CampaignStatus
  }): Promise<ListResult<Campaign>> {
    const campaignsMap = await this.storage.list({ prefix: this.PREFIX })
    const campaigns: Campaign[] = []

    for (const value of campaignsMap.values()) {
      const campaign = value as Campaign
      if (campaign.archived) continue
      if (options?.type && campaign.type !== options.type) continue
      if (options?.status && campaign.status !== options.status) continue
      campaigns.push(campaign)
    }

    campaigns.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

    const limit = options?.limit ?? 100
    let startIndex = 0
    if (options?.after) {
      const afterIndex = campaigns.findIndex((c) => c.id === options.after)
      if (afterIndex !== -1) startIndex = afterIndex + 1
    }

    const paged = campaigns.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < campaigns.length

    return {
      results: paged,
      paging: hasMore ? { next: { after: paged[paged.length - 1]?.id ?? '' } } : undefined,
    }
  }

  /**
   * Start a campaign
   */
  async start(campaignId: string): Promise<Campaign> {
    const campaign = await this.getById(campaignId)

    if (campaign.status === 'running') {
      throw new HubSpotMarketingError(
        'Campaign is already running',
        'ALREADY_RUNNING',
        400
      )
    }

    const startedCampaign: Campaign = {
      ...campaign,
      status: 'running',
      startDate: campaign.startDate ?? now(),
      updatedAt: now(),
    }

    await this.storage.put(`${this.PREFIX}${campaignId}`, startedCampaign)
    return startedCampaign
  }

  /**
   * Pause a campaign
   */
  async pause(campaignId: string): Promise<Campaign> {
    const campaign = await this.getById(campaignId)

    if (campaign.status !== 'running') {
      throw new HubSpotMarketingError(
        'Campaign must be running to pause',
        'NOT_RUNNING',
        400
      )
    }

    const pausedCampaign: Campaign = {
      ...campaign,
      status: 'paused',
      updatedAt: now(),
    }

    await this.storage.put(`${this.PREFIX}${campaignId}`, pausedCampaign)
    return pausedCampaign
  }

  /**
   * Complete a campaign
   */
  async complete(campaignId: string): Promise<Campaign> {
    const campaign = await this.getById(campaignId)

    const completedCampaign: Campaign = {
      ...campaign,
      status: 'completed',
      endDate: campaign.endDate ?? now(),
      updatedAt: now(),
    }

    await this.storage.put(`${this.PREFIX}${campaignId}`, completedCampaign)
    return completedCampaign
  }

  /**
   * Add an asset to a campaign
   */
  async addAsset(campaignId: string, input: AddAssetInput): Promise<CampaignAsset> {
    const campaign = await this.getById(campaignId)

    const asset: CampaignAsset = {
      id: generateId('asset'),
      type: input.type,
      assetId: input.assetId,
      name: input.name ?? `${input.type}-${input.assetId}`,
      status: 'active',
      addedAt: now(),
    }

    campaign.assets.push(asset)
    campaign.updatedAt = now()

    await this.storage.put(`${this.PREFIX}${campaignId}`, campaign)
    return asset
  }

  /**
   * Remove an asset from a campaign
   */
  async removeAsset(campaignId: string, assetId: string): Promise<void> {
    const campaign = await this.getById(campaignId)

    const index = campaign.assets.findIndex((a) => a.id === assetId)
    if (index === -1) {
      throw new HubSpotMarketingError(
        `Asset not found: ${assetId}`,
        'ASSET_NOT_FOUND',
        404
      )
    }

    campaign.assets.splice(index, 1)
    campaign.updatedAt = now()

    await this.storage.put(`${this.PREFIX}${campaignId}`, campaign)
  }

  /**
   * Add an audience to a campaign
   */
  async addAudience(campaignId: string, audience: Omit<CampaignAudience, 'id'>): Promise<CampaignAudience> {
    const campaign = await this.getById(campaignId)

    const newAudience: CampaignAudience = {
      id: generateId('audience'),
      ...audience,
    }

    campaign.audiences.push(newAudience)
    campaign.updatedAt = now()

    await this.storage.put(`${this.PREFIX}${campaignId}`, campaign)
    return newAudience
  }

  /**
   * Remove an audience from a campaign
   */
  async removeAudience(campaignId: string, audienceId: string): Promise<void> {
    const campaign = await this.getById(campaignId)

    const index = campaign.audiences.findIndex((a) => a.id === audienceId)
    if (index === -1) {
      throw new HubSpotMarketingError(
        `Audience not found: ${audienceId}`,
        'AUDIENCE_NOT_FOUND',
        404
      )
    }

    campaign.audiences.splice(index, 1)
    campaign.updatedAt = now()

    await this.storage.put(`${this.PREFIX}${campaignId}`, campaign)
  }

  /**
   * Get campaign analytics
   */
  async getAnalytics(campaignId: string): Promise<CampaignAnalytics> {
    const campaign = await this.getById(campaignId)

    if (!campaign.analytics) {
      return {
        impressions: 0,
        reach: 0,
        clicks: 0,
        uniqueClicks: 0,
        conversions: 0,
        conversionRate: 0,
        leads: 0,
        customers: 0,
        revenue: 0,
        roi: 0,
        costPerLead: 0,
        costPerCustomer: 0,
        engagementRate: 0,
        byChannel: {} as Record<CampaignAssetType, { impressions: number; clicks: number; conversions: number; spend: number }>,
        byDate: [],
      }
    }

    return campaign.analytics
  }

  /**
   * Clone a campaign
   */
  async clone(campaignId: string, newName: string): Promise<Campaign> {
    const campaign = await this.getById(campaignId)

    return this.create({
      name: newName,
      description: campaign.description,
      type: campaign.type,
      budget: campaign.budget,
      goals: campaign.goals,
      settings: campaign.settings,
    })
  }
}

// =============================================================================
// Marketing Events API
// =============================================================================

/**
 * Marketing Events API for event and webinar management
 */
export class MarketingEventsApi {
  private storage: MarketingStorage
  private readonly PREFIX = {
    event: 'event:',
    registration: 'event_reg:',
  }

  constructor(storage: MarketingStorage) {
    this.storage = storage
  }

  /**
   * Create a new event
   */
  async create(input: CreateEventInput): Promise<MarketingEvent> {
    const id = generateId('event')
    const timestamp = now()

    const event: MarketingEvent = {
      id,
      name: input.name,
      description: input.description,
      type: input.type,
      status: 'draft',
      startTime: input.startTime,
      endTime: input.endTime,
      timezone: input.timezone ?? 'UTC',
      location: input.location as EventLocation,
      registrationUrl: input.registrationUrl,
      capacity: input.capacity,
      registrations: [],
      campaignId: input.campaignId,
      externalId: input.externalId,
      externalProvider: input.externalProvider,
      settings: {
        requireApproval: false,
        enableWaitlist: false,
        sendConfirmation: true,
        sendReminders: true,
        ...input.settings,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    }

    await this.storage.put(`${this.PREFIX.event}${id}`, event)
    return event
  }

  /**
   * Get an event by ID
   */
  async getById(eventId: string): Promise<MarketingEvent> {
    const event = await this.storage.get<MarketingEvent>(`${this.PREFIX.event}${eventId}`)
    if (!event || event.archived) {
      throw new HubSpotMarketingError(
        `Event not found: ${eventId}`,
        'EVENT_NOT_FOUND',
        404
      )
    }
    return event
  }

  /**
   * Update an event
   */
  async update(eventId: string, input: UpdateEventInput): Promise<MarketingEvent> {
    const event = await this.getById(eventId)

    const updatedEvent: MarketingEvent = {
      ...event,
      ...input,
      location: input.location ? {
        ...event.location,
        ...input.location,
      } as EventLocation : event.location,
      settings: {
        ...event.settings,
        ...input.settings,
      },
      updatedAt: now(),
    }

    await this.storage.put(`${this.PREFIX.event}${eventId}`, updatedEvent)
    return updatedEvent
  }

  /**
   * Delete (archive) an event
   */
  async archive(eventId: string): Promise<void> {
    const event = await this.getById(eventId)
    const timestamp = now()

    const archivedEvent: MarketingEvent = {
      ...event,
      archived: true,
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.event}${eventId}`, archivedEvent)
  }

  /**
   * List all events
   */
  async list(options?: {
    limit?: number
    after?: string
    type?: MarketingEventType
    status?: EventStatus
  }): Promise<ListResult<MarketingEvent>> {
    const eventsMap = await this.storage.list({ prefix: this.PREFIX.event })
    const events: MarketingEvent[] = []

    for (const value of eventsMap.values()) {
      const event = value as MarketingEvent
      if (event.archived) continue
      if (options?.type && event.type !== options.type) continue
      if (options?.status && event.status !== options.status) continue
      events.push(event)
    }

    events.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())

    const limit = options?.limit ?? 100
    let startIndex = 0
    if (options?.after) {
      const afterIndex = events.findIndex((e) => e.id === options.after)
      if (afterIndex !== -1) startIndex = afterIndex + 1
    }

    const paged = events.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < events.length

    return {
      results: paged,
      paging: hasMore ? { next: { after: paged[paged.length - 1]?.id ?? '' } } : undefined,
    }
  }

  /**
   * Publish an event
   */
  async publish(eventId: string): Promise<MarketingEvent> {
    const event = await this.getById(eventId)

    if (event.status !== 'draft') {
      throw new HubSpotMarketingError(
        `Event must be in draft state to publish. Current state: ${event.status}`,
        'INVALID_STATE',
        400
      )
    }

    const publishedEvent: MarketingEvent = {
      ...event,
      status: 'published',
      updatedAt: now(),
    }

    await this.storage.put(`${this.PREFIX.event}${eventId}`, publishedEvent)
    return publishedEvent
  }

  /**
   * Start an event (set to live)
   */
  async start(eventId: string): Promise<MarketingEvent> {
    const event = await this.getById(eventId)

    const liveEvent: MarketingEvent = {
      ...event,
      status: 'live',
      updatedAt: now(),
    }

    await this.storage.put(`${this.PREFIX.event}${eventId}`, liveEvent)
    return liveEvent
  }

  /**
   * Complete an event
   */
  async complete(eventId: string): Promise<MarketingEvent> {
    const event = await this.getById(eventId)

    const completedEvent: MarketingEvent = {
      ...event,
      status: 'completed',
      updatedAt: now(),
      analytics: this.calculateAnalytics(event),
    }

    await this.storage.put(`${this.PREFIX.event}${eventId}`, completedEvent)
    return completedEvent
  }

  /**
   * Cancel an event
   */
  async cancel(eventId: string): Promise<MarketingEvent> {
    const event = await this.getById(eventId)

    const cancelledEvent: MarketingEvent = {
      ...event,
      status: 'cancelled',
      updatedAt: now(),
    }

    await this.storage.put(`${this.PREFIX.event}${eventId}`, cancelledEvent)
    return cancelledEvent
  }

  /**
   * Register a contact for an event
   */
  async register(eventId: string, input: RegisterContactInput): Promise<EventRegistration> {
    const event = await this.getById(eventId)

    // Check capacity
    if (event.capacity) {
      const activeRegistrations = event.registrations.filter(
        (r) => r.status === 'registered' || r.status === 'attended'
      )
      if (activeRegistrations.length >= event.capacity) {
        if (event.settings.enableWaitlist) {
          // Add to waitlist
          const registration: EventRegistration = {
            id: generateId('reg'),
            eventId,
            contactId: input.contactId,
            status: 'waitlisted',
            registeredAt: now(),
            source: input.source,
            customFields: input.customFields,
          }
          event.registrations.push(registration)
          event.updatedAt = now()
          await this.storage.put(`${this.PREFIX.event}${eventId}`, event)
          return registration
        }
        throw new HubSpotMarketingError(
          'Event is at capacity',
          'EVENT_FULL',
          400
        )
      }
    }

    // Check for duplicate registration
    const existingReg = event.registrations.find(
      (r) => r.contactId === input.contactId && r.status !== 'cancelled'
    )
    if (existingReg) {
      throw new HubSpotMarketingError(
        'Contact already registered for this event',
        'ALREADY_REGISTERED',
        409
      )
    }

    const registration: EventRegistration = {
      id: generateId('reg'),
      eventId,
      contactId: input.contactId,
      status: event.settings.requireApproval ? 'waitlisted' : 'registered',
      registeredAt: now(),
      source: input.source,
      customFields: input.customFields,
    }

    event.registrations.push(registration)
    event.updatedAt = now()

    await this.storage.put(`${this.PREFIX.event}${eventId}`, event)
    return registration
  }

  /**
   * Update registration status (attended, cancelled, etc.)
   */
  async updateRegistration(
    eventId: string,
    registrationId: string,
    status: RegistrationStatus
  ): Promise<EventRegistration> {
    const event = await this.getById(eventId)

    const registration = event.registrations.find((r) => r.id === registrationId)
    if (!registration) {
      throw new HubSpotMarketingError(
        `Registration not found: ${registrationId}`,
        'REGISTRATION_NOT_FOUND',
        404
      )
    }

    registration.status = status
    if (status === 'attended') {
      registration.attendedAt = now()
    } else if (status === 'cancelled') {
      registration.cancelledAt = now()
    }

    event.updatedAt = now()
    await this.storage.put(`${this.PREFIX.event}${eventId}`, event)
    return registration
  }

  /**
   * Cancel a registration
   */
  async cancelRegistration(eventId: string, registrationId: string): Promise<void> {
    await this.updateRegistration(eventId, registrationId, 'cancelled')
  }

  /**
   * Get registrations for an event
   */
  async getRegistrations(
    eventId: string,
    options?: { status?: RegistrationStatus; limit?: number }
  ): Promise<EventRegistration[]> {
    const event = await this.getById(eventId)

    let registrations = event.registrations
    if (options?.status) {
      registrations = registrations.filter((r) => r.status === options.status)
    }

    registrations.sort((a, b) => b.registeredAt.localeCompare(a.registeredAt))

    if (options?.limit) {
      registrations = registrations.slice(0, options.limit)
    }

    return registrations
  }

  /**
   * Get event analytics
   */
  async getAnalytics(eventId: string): Promise<EventAnalytics> {
    const event = await this.getById(eventId)
    return this.calculateAnalytics(event)
  }

  /**
   * Calculate analytics for an event
   */
  private calculateAnalytics(event: MarketingEvent): EventAnalytics {
    const registrations = event.registrations
    const attended = registrations.filter((r) => r.status === 'attended')
    const noShows = registrations.filter((r) => r.status === 'no_show')
    const cancelled = registrations.filter((r) => r.status === 'cancelled')

    const registrationsBySource: Record<string, number> = {}
    for (const reg of registrations) {
      const source = reg.source ?? 'direct'
      registrationsBySource[source] = (registrationsBySource[source] ?? 0) + 1
    }

    const registrationsByDate: Array<{ date: string; count: number }> = []
    const dateMap = new Map<string, number>()
    for (const reg of registrations) {
      const date = reg.registeredAt.split('T')[0]
      dateMap.set(date, (dateMap.get(date) ?? 0) + 1)
    }
    for (const [date, count] of dateMap.entries()) {
      registrationsByDate.push({ date, count })
    }
    registrationsByDate.sort((a, b) => a.date.localeCompare(b.date))

    const totalRegistrations = registrations.filter(
      (r) => r.status !== 'cancelled'
    ).length

    return {
      totalRegistrations,
      totalAttendees: attended.length,
      noShows: noShows.length,
      cancellations: cancelled.length,
      attendanceRate: totalRegistrations > 0
        ? (attended.length / totalRegistrations) * 100
        : 0,
      registrationsBySource,
      registrationsByDate,
    }
  }
}

// =============================================================================
// Marketing Lists API
// =============================================================================

/**
 * Marketing Lists API for list management
 */
export class MarketingListsApi {
  private storage: MarketingStorage
  private readonly PREFIX = {
    list: 'list:',
    member: 'list_member:',
  }

  constructor(storage: MarketingStorage) {
    this.storage = storage
  }

  /**
   * Create a new list
   */
  async create(input: CreateListInput): Promise<MarketingList> {
    const id = generateId('list')
    const timestamp = now()

    const list: MarketingList = {
      id,
      name: input.name,
      description: input.description,
      type: input.type ?? 'static',
      objectType: input.objectType ?? 'contacts',
      filters: input.type === 'dynamic' ? input.filters : undefined,
      memberCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    }

    await this.storage.put(`${this.PREFIX.list}${id}`, list)
    return list
  }

  /**
   * Get a list by ID
   */
  async getById(listId: string): Promise<MarketingList> {
    const list = await this.storage.get<MarketingList>(`${this.PREFIX.list}${listId}`)
    if (!list || list.archived) {
      throw new HubSpotMarketingError(
        `List not found: ${listId}`,
        'LIST_NOT_FOUND',
        404
      )
    }
    return list
  }

  /**
   * Update a list
   */
  async update(listId: string, input: UpdateListInput): Promise<MarketingList> {
    const list = await this.getById(listId)

    const updatedList: MarketingList = {
      ...list,
      ...input,
      updatedAt: now(),
    }

    await this.storage.put(`${this.PREFIX.list}${listId}`, updatedList)
    return updatedList
  }

  /**
   * Delete (archive) a list
   */
  async archive(listId: string): Promise<void> {
    const list = await this.getById(listId)
    const timestamp = now()

    const archivedList: MarketingList = {
      ...list,
      archived: true,
      archivedAt: timestamp,
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.list}${listId}`, archivedList)
  }

  /**
   * List all lists
   */
  async list(options?: {
    limit?: number
    after?: string
    type?: MarketingListType
    objectType?: ListObjectType
  }): Promise<ListResult<MarketingList>> {
    const listsMap = await this.storage.list({ prefix: this.PREFIX.list })
    const lists: MarketingList[] = []

    for (const value of listsMap.values()) {
      const list = value as MarketingList
      if (list.archived) continue
      if (options?.type && list.type !== options.type) continue
      if (options?.objectType && list.objectType !== options.objectType) continue
      lists.push(list)
    }

    lists.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

    const limit = options?.limit ?? 100
    let startIndex = 0
    if (options?.after) {
      const afterIndex = lists.findIndex((l) => l.id === options.after)
      if (afterIndex !== -1) startIndex = afterIndex + 1
    }

    const paged = lists.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < lists.length

    return {
      results: paged,
      paging: hasMore ? { next: { after: paged[paged.length - 1]?.id ?? '' } } : undefined,
    }
  }

  /**
   * Add members to a static list
   */
  async addMembers(listId: string, input: AddMembersInput): Promise<{ added: number }> {
    const list = await this.getById(listId)

    if (list.type !== 'static') {
      throw new HubSpotMarketingError(
        'Cannot manually add members to a dynamic list',
        'INVALID_LIST_TYPE',
        400
      )
    }

    const membersKey = `${this.PREFIX.member}${listId}`
    const existingMembers = await this.storage.get<ListMember[]>(membersKey) ?? []
    const existingIds = new Set(existingMembers.map((m) => m.objectId))

    let added = 0
    const timestamp = now()

    for (const objectId of input.objectIds) {
      if (!existingIds.has(objectId)) {
        existingMembers.push({
          id: generateId('member'),
          objectId,
          objectType: list.objectType,
          addedAt: timestamp,
          source: 'api',
        })
        added++
      }
    }

    await this.storage.put(membersKey, existingMembers)

    // Update member count
    list.memberCount = existingMembers.length
    list.updatedAt = timestamp
    await this.storage.put(`${this.PREFIX.list}${listId}`, list)

    return { added }
  }

  /**
   * Remove members from a static list
   */
  async removeMembers(listId: string, objectIds: string[]): Promise<{ removed: number }> {
    const list = await this.getById(listId)

    if (list.type !== 'static') {
      throw new HubSpotMarketingError(
        'Cannot manually remove members from a dynamic list',
        'INVALID_LIST_TYPE',
        400
      )
    }

    const membersKey = `${this.PREFIX.member}${listId}`
    const existingMembers = await this.storage.get<ListMember[]>(membersKey) ?? []
    const removeSet = new Set(objectIds)

    const filteredMembers = existingMembers.filter((m) => !removeSet.has(m.objectId))
    const removed = existingMembers.length - filteredMembers.length

    await this.storage.put(membersKey, filteredMembers)

    // Update member count
    list.memberCount = filteredMembers.length
    list.updatedAt = now()
    await this.storage.put(`${this.PREFIX.list}${listId}`, list)

    return { removed }
  }

  /**
   * Get members of a list
   */
  async getMembers(listId: string, options?: {
    limit?: number
    after?: string
  }): Promise<ListResult<ListMember>> {
    await this.getById(listId) // Verify list exists

    const membersKey = `${this.PREFIX.member}${listId}`
    const members = await this.storage.get<ListMember[]>(membersKey) ?? []

    members.sort((a, b) => b.addedAt.localeCompare(a.addedAt))

    const limit = options?.limit ?? 100
    let startIndex = 0
    if (options?.after) {
      const afterIndex = members.findIndex((m) => m.id === options.after)
      if (afterIndex !== -1) startIndex = afterIndex + 1
    }

    const paged = members.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < members.length

    return {
      results: paged,
      paging: hasMore ? { next: { after: paged[paged.length - 1]?.id ?? '' } } : undefined,
    }
  }

  /**
   * Check if a contact is in a list
   */
  async isMember(listId: string, objectId: string): Promise<boolean> {
    await this.getById(listId) // Verify list exists

    const membersKey = `${this.PREFIX.member}${listId}`
    const members = await this.storage.get<ListMember[]>(membersKey) ?? []

    return members.some((m) => m.objectId === objectId)
  }

  /**
   * Clear all members from a static list
   */
  async clear(listId: string): Promise<void> {
    const list = await this.getById(listId)

    if (list.type !== 'static') {
      throw new HubSpotMarketingError(
        'Cannot clear a dynamic list',
        'INVALID_LIST_TYPE',
        400
      )
    }

    const membersKey = `${this.PREFIX.member}${listId}`
    await this.storage.put(membersKey, [])

    list.memberCount = 0
    list.updatedAt = now()
    await this.storage.put(`${this.PREFIX.list}${listId}`, list)
  }
}

// =============================================================================
// Main HubSpotMarketing Class
// =============================================================================

/**
 * HubSpot Marketing Hub compatibility layer
 *
 * Provides unified access to marketing emails, campaigns, events, and lists.
 *
 * @example
 * ```typescript
 * const marketing = new HubSpotMarketing(storage)
 *
 * // Create and send an email
 * const email = await marketing.emails.create({
 *   name: 'Launch Announcement',
 *   subject: 'Exciting News!',
 *   body: '<html>...</html>',
 * })
 * await marketing.emails.publish(email.id, { listIds: ['list-123'] })
 *
 * // Create a campaign with assets
 * const campaign = await marketing.campaigns.create({
 *   name: 'Product Launch',
 *   type: 'multi_channel',
 * })
 * await marketing.campaigns.addAsset(campaign.id, {
 *   type: 'email',
 *   assetId: email.id,
 * })
 *
 * // Create an event
 * const event = await marketing.events.create({
 *   name: 'Product Demo',
 *   type: 'webinar',
 *   startTime: '2026-02-01T10:00:00Z',
 *   endTime: '2026-02-01T11:00:00Z',
 * })
 * await marketing.events.register(event.id, { contactId: 'contact-456' })
 * ```
 */
export class HubSpotMarketing {
  readonly emails: MarketingEmailsApi
  readonly campaigns: MarketingCampaignsApi
  readonly events: MarketingEventsApi
  readonly lists: MarketingListsApi

  constructor(storage: MarketingStorage) {
    this.emails = new MarketingEmailsApi(storage)
    this.campaigns = new MarketingCampaignsApi(storage)
    this.events = new MarketingEventsApi(storage)
    this.lists = new MarketingListsApi(storage)
  }

  /**
   * Clear all marketing data (for testing)
   */
  async clear(): Promise<void> {
    // This would be implemented based on storage interface
    // For now, it's a placeholder for testing environments
  }
}

// =============================================================================
// Export Default
// =============================================================================

export default HubSpotMarketing
