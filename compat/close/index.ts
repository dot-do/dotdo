/**
 * @dotdo/close - Close CRM Compatibility Layer
 *
 * Local implementation of Close CRM APIs backed by DO storage.
 * Close uses a Lead-centric model: Leads contain Contacts and Opportunities.
 *
 * @example
 * ```typescript
 * import { CloseClient } from '@dotdo/close'
 *
 * const client = new CloseClient({ storage: ctx.storage })
 *
 * // Create a lead with contacts
 * const lead = await client.leads.create({
 *   name: 'Acme Corp',
 *   contacts: [
 *     { name: 'John Doe', emails: [{ email: 'john@acme.com', type: 'office' }] }
 *   ],
 * })
 *
 * // Create an opportunity
 * const opp = await client.opportunities.create({
 *   lead_id: lead.id,
 *   note: 'Enterprise deal',
 *   value: 50000,
 * })
 * ```
 *
 * @module @dotdo/close
 */

// =============================================================================
// Type Definitions
// =============================================================================

export interface EmailField {
  email: string
  type?: 'office' | 'home' | 'direct' | 'mobile' | 'fax' | 'other'
}

export interface PhoneField {
  phone: string
  type?: 'office' | 'home' | 'direct' | 'mobile' | 'fax' | 'other'
  country?: string
}

export interface UrlField {
  url: string
  type?: 'url' | 'linkedin' | 'twitter' | 'facebook' | 'other'
}

export interface AddressField {
  label?: string
  address_1?: string
  address_2?: string
  city?: string
  state?: string
  zipcode?: string
  country?: string
}

/**
 * Lead entity - the primary organization/company record in Close
 */
export interface Lead {
  id: string
  name: string
  description?: string
  url?: string
  status_id: string
  status_label?: string
  addresses?: AddressField[]
  contacts?: Contact[]
  opportunities?: Opportunity[]
  tasks?: Task[]
  organization_id?: string
  date_created: string
  date_updated: string
  created_by?: string
  updated_by?: string
  custom?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Contact entity - person associated with a Lead
 */
export interface Contact {
  id: string
  lead_id: string
  name: string
  title?: string
  emails?: EmailField[]
  phones?: PhoneField[]
  urls?: UrlField[]
  organization_id?: string
  date_created: string
  date_updated: string
  created_by?: string
  updated_by?: string
  custom?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Opportunity entity - sales opportunity associated with a Lead
 */
export interface Opportunity {
  id: string
  lead_id: string
  lead_name?: string
  contact_id?: string
  contact_name?: string
  status_id: string
  status_label?: string
  status_type?: 'active' | 'won' | 'lost'
  note?: string
  value?: number
  value_period?: 'one_time' | 'monthly' | 'annual'
  value_formatted?: string
  value_currency?: string
  expected_value?: number
  confidence?: number
  date_won?: string | null
  date_lost?: string | null
  user_id?: string
  user_name?: string
  organization_id?: string
  date_created: string
  date_updated: string
  custom?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Base Activity entity
 */
export interface Activity {
  id: string
  _type: 'Email' | 'Call' | 'SMS' | 'Note' | 'Meeting' | 'Created' | 'StatusChange'
  lead_id: string
  contact_id?: string
  user_id?: string
  user_name?: string
  organization_id?: string
  date_created: string
  date_updated: string
  [key: string]: unknown
}

/**
 * Email Activity
 */
export interface EmailActivity extends Activity {
  _type: 'Email'
  subject: string
  body_text?: string
  body_html?: string
  direction: 'outgoing' | 'incoming'
  status: 'sent' | 'draft' | 'inbox' | 'outbox' | 'scheduled'
  sender?: string
  to?: string[]
  cc?: string[]
  bcc?: string[]
  attachments?: Array<{ filename: string; size: number; url?: string }>
  date_sent?: string
  envelope?: {
    from?: string
    to?: string[]
  }
}

/**
 * Call Activity
 */
export interface CallActivity extends Activity {
  _type: 'Call'
  direction: 'outbound' | 'inbound'
  duration?: number
  note?: string
  disposition?: string
  phone?: string
  voicemail_url?: string
  voicemail_duration?: number
  recording_url?: string
}

/**
 * SMS Activity
 */
export interface SMSActivity extends Activity {
  _type: 'SMS'
  direction: 'outbound' | 'inbound'
  text: string
  status: 'sent' | 'draft' | 'inbox' | 'outbox' | 'scheduled' | 'failed'
  local_phone?: string
  remote_phone?: string
}

/**
 * Note Activity
 */
export interface NoteActivity extends Activity {
  _type: 'Note'
  note: string
}

/**
 * Meeting Activity
 */
export interface MeetingActivity extends Activity {
  _type: 'Meeting'
  title: string
  starts_at: string
  ends_at?: string
  duration?: number
  location?: string
  note?: string
  attendees?: Array<{ email: string; name?: string; is_organizer?: boolean }>
  source?: string
}

/**
 * Task entity
 */
export interface Task {
  id: string
  lead_id: string
  lead_name?: string
  assigned_to?: string
  assigned_to_name?: string
  text: string
  date?: string
  due_date?: string
  is_complete: boolean
  is_dateless: boolean
  object_type?: string
  object_id?: string
  organization_id?: string
  date_created: string
  date_updated: string
  [key: string]: unknown
}

/**
 * Lead Status
 */
export interface Status {
  id: string
  label: string
  organization_id?: string
}

/**
 * Opportunity Status
 */
export interface OpportunityStatus {
  id: string
  label: string
  type: 'active' | 'won' | 'lost'
  organization_id?: string
}

/**
 * Smart View
 */
export interface SmartView {
  id: string
  name: string
  type: 'lead' | 'contact' | 'opportunity'
  query: string
  organization_id?: string
  user_id?: string
  date_created: string
  date_updated: string
}

/**
 * Custom Field
 */
export interface CustomField {
  id: string
  name: string
  type: 'text' | 'number' | 'date' | 'datetime' | 'choices' | 'user' | 'contact'
  object_type: 'lead' | 'contact' | 'opportunity'
  choices?: string[]
  organization_id?: string
  date_created: string
  date_updated: string
}

/**
 * User entity
 */
export interface User {
  id: string
  email: string
  first_name?: string
  last_name?: string
  image?: string
  organization_id?: string
  date_created: string
  date_updated: string
}

// =============================================================================
// Input Types
// =============================================================================

export interface LeadCreateInput {
  name: string
  description?: string
  url?: string
  status_id?: string
  addresses?: AddressField[]
  contacts?: ContactInlineInput[]
  custom?: Record<string, unknown>
}

export interface ContactInlineInput {
  name: string
  title?: string
  emails?: EmailField[]
  phones?: PhoneField[]
  urls?: UrlField[]
}

export interface LeadUpdateInput {
  name?: string
  description?: string
  url?: string
  status_id?: string
  addresses?: AddressField[]
  custom?: Record<string, unknown>
}

export interface ContactCreateInput {
  lead_id: string
  name: string
  title?: string
  emails?: EmailField[]
  phones?: PhoneField[]
  urls?: UrlField[]
  custom?: Record<string, unknown>
}

export interface ContactUpdateInput {
  name?: string
  title?: string
  emails?: EmailField[]
  phones?: PhoneField[]
  urls?: UrlField[]
  custom?: Record<string, unknown>
}

export interface OpportunityCreateInput {
  lead_id: string
  contact_id?: string
  status_id?: string
  note?: string
  value?: number
  value_period?: 'one_time' | 'monthly' | 'annual'
  value_currency?: string
  expected_value?: number
  confidence?: number
  custom?: Record<string, unknown>
}

export interface OpportunityUpdateInput {
  contact_id?: string
  status_id?: string
  note?: string
  value?: number
  value_period?: 'one_time' | 'monthly' | 'annual'
  value_currency?: string
  expected_value?: number
  confidence?: number
  date_won?: string | null
  date_lost?: string | null
  custom?: Record<string, unknown>
}

export interface EmailCreateInput {
  lead_id: string
  contact_id?: string
  subject: string
  body_text?: string
  body_html?: string
  direction: 'outgoing' | 'incoming'
  status: 'sent' | 'draft' | 'inbox'
  sender?: string
  to?: string[]
  cc?: string[]
  bcc?: string[]
}

export interface CallCreateInput {
  lead_id: string
  contact_id?: string
  direction: 'outbound' | 'inbound'
  duration?: number
  note?: string
  disposition?: string
  phone?: string
}

export interface SMSCreateInput {
  lead_id: string
  contact_id?: string
  direction: 'outbound' | 'inbound'
  text: string
  status: 'sent' | 'draft' | 'inbox'
  local_phone?: string
  remote_phone?: string
}

export interface NoteCreateInput {
  lead_id: string
  contact_id?: string
  note: string
}

export interface MeetingCreateInput {
  lead_id: string
  contact_id?: string
  title: string
  starts_at: string
  ends_at?: string
  duration?: number
  location?: string
  note?: string
  attendees?: Array<{ email: string; name?: string }>
}

export interface TaskCreateInput {
  lead_id: string
  text: string
  date?: string
  assigned_to?: string
  is_dateless?: boolean
}

export interface TaskUpdateInput {
  text?: string
  date?: string
  assigned_to?: string
  is_complete?: boolean
}

export interface StatusCreateInput {
  label: string
}

export interface OpportunityStatusCreateInput {
  label: string
  type: 'active' | 'won' | 'lost'
}

export interface SmartViewCreateInput {
  name: string
  type: 'lead' | 'contact' | 'opportunity'
  query: string
}

export interface CustomFieldCreateInput {
  name: string
  type: 'text' | 'number' | 'date' | 'datetime' | 'choices' | 'user' | 'contact'
  object_type: 'lead' | 'contact' | 'opportunity'
  choices?: string[]
}

// =============================================================================
// Response Types
// =============================================================================

export interface CloseResponse<T> {
  data: T[]
  has_more: boolean
  total_results?: number
}

export interface ListOptions {
  _skip?: number
  _limit?: number
  _fields?: string[]
}

export interface BulkResult {
  updated: number
  errors: Array<{ id: string; error: string }>
}

// =============================================================================
// Error Class
// =============================================================================

export class CloseError extends Error {
  errorCode: string
  httpStatus: number
  details?: Record<string, unknown>

  constructor(
    message: string,
    errorCode: string,
    httpStatus: number = 400,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'CloseError'
    this.errorCode = errorCode
    this.httpStatus = httpStatus
    this.details = details
  }
}

// =============================================================================
// Storage Interface
// =============================================================================

export interface CloseStorage {
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T): void
  delete(key: string): boolean
  keys(): IterableIterator<string>
}

class MapStorageAdapter implements CloseStorage {
  constructor(private map: Map<string, unknown>) {}

  get<T>(key: string): T | undefined {
    return this.map.get(key) as T | undefined
  }

  set<T>(key: string, value: T): void {
    this.map.set(key, value)
  }

  delete(key: string): boolean {
    return this.map.delete(key)
  }

  keys(): IterableIterator<string> {
    return this.map.keys()
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let id = ''
  for (let i = 0; i < 22; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return `${prefix}_${id}`
}

function now(): string {
  return new Date().toISOString()
}

function matchesQuery(item: Record<string, unknown>, query: string): boolean {
  const queryLower = query.toLowerCase()
  for (const value of Object.values(item)) {
    if (typeof value === 'string' && value.toLowerCase().includes(queryLower)) {
      return true
    }
  }
  return false
}

// =============================================================================
// Resource Classes
// =============================================================================

class LeadsResource {
  private storage: CloseStorage
  private prefix = 'close:lead:'
  private defaultStatusId: string

  constructor(storage: CloseStorage, defaultStatusId: string) {
    this.storage = storage
    this.defaultStatusId = defaultStatusId
  }

  private getAll(): Lead[] {
    const leads: Lead[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const lead = this.storage.get<Lead>(key)
        if (lead) {
          leads.push(lead)
        }
      }
    }
    return leads
  }

  async create(input: LeadCreateInput): Promise<Lead> {
    const id = generateId('lead')
    const timestamp = now()

    // Create inline contacts if provided
    const contacts: Contact[] = []
    if (input.contacts) {
      for (const contactInput of input.contacts) {
        const contactId = generateId('cont')
        const contact: Contact = {
          id: contactId,
          lead_id: id,
          name: contactInput.name,
          title: contactInput.title,
          emails: contactInput.emails,
          phones: contactInput.phones,
          urls: contactInput.urls,
          date_created: timestamp,
          date_updated: timestamp,
        }
        this.storage.set(`close:contact:${contactId}`, contact)
        contacts.push(contact)
      }
    }

    const lead: Lead = {
      id,
      name: input.name,
      description: input.description,
      url: input.url,
      status_id: input.status_id ?? this.defaultStatusId,
      addresses: input.addresses,
      contacts,
      opportunities: [],
      tasks: [],
      custom: input.custom,
      date_created: timestamp,
      date_updated: timestamp,
    }

    this.storage.set(`${this.prefix}${id}`, lead)
    return lead
  }

  async get(id: string): Promise<Lead | null> {
    return this.storage.get<Lead>(`${this.prefix}${id}`) ?? null
  }

  async update(id: string, input: LeadUpdateInput): Promise<Lead> {
    const existing = await this.get(id)
    if (!existing) {
      throw new CloseError(`Lead not found: ${id}`, 'NOT_FOUND', 404)
    }

    const updated: Lead = {
      ...existing,
      ...input,
      id,
      date_updated: now(),
    }

    this.storage.set(`${this.prefix}${id}`, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new CloseError(`Lead not found: ${id}`, 'NOT_FOUND', 404)
    }
    this.storage.delete(`${this.prefix}${id}`)
  }

  async search(options: { query: string } & ListOptions): Promise<CloseResponse<Lead>> {
    const all = this.getAll()
    const filtered = options.query
      ? all.filter((l) => matchesQuery(l, options.query))
      : all

    const skip = options._skip ?? 0
    const limit = options._limit ?? 100
    const paged = filtered.slice(skip, skip + limit)

    return {
      data: paged,
      has_more: skip + limit < filtered.length,
      total_results: filtered.length,
    }
  }

  async list(options?: ListOptions): Promise<CloseResponse<Lead>> {
    const all = this.getAll()
    const skip = options?._skip ?? 0
    const limit = options?._limit ?? 100
    const paged = all.slice(skip, skip + limit)

    return {
      data: paged,
      has_more: skip + limit < all.length,
      total_results: all.length,
    }
  }

  async bulkUpdate(
    updates: Array<{ id: string } & LeadUpdateInput>
  ): Promise<BulkResult> {
    let updated = 0
    const errors: Array<{ id: string; error: string }> = []

    for (const update of updates) {
      try {
        await this.update(update.id, update)
        updated++
      } catch (error) {
        errors.push({
          id: update.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return { updated, errors }
  }

  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id)
    }
  }
}

class ContactsResource {
  private storage: CloseStorage
  private prefix = 'close:contact:'

  constructor(storage: CloseStorage) {
    this.storage = storage
  }

  private getAll(): Contact[] {
    const contacts: Contact[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const contact = this.storage.get<Contact>(key)
        if (contact) {
          contacts.push(contact)
        }
      }
    }
    return contacts
  }

  async create(input: ContactCreateInput): Promise<Contact> {
    const id = generateId('cont')
    const timestamp = now()

    const contact: Contact = {
      id,
      lead_id: input.lead_id,
      name: input.name,
      title: input.title,
      emails: input.emails,
      phones: input.phones,
      urls: input.urls,
      custom: input.custom,
      date_created: timestamp,
      date_updated: timestamp,
    }

    this.storage.set(`${this.prefix}${id}`, contact)
    return contact
  }

  async get(id: string): Promise<Contact | null> {
    return this.storage.get<Contact>(`${this.prefix}${id}`) ?? null
  }

  async update(id: string, input: ContactUpdateInput): Promise<Contact> {
    const existing = await this.get(id)
    if (!existing) {
      throw new CloseError(`Contact not found: ${id}`, 'NOT_FOUND', 404)
    }

    const updated: Contact = {
      ...existing,
      ...input,
      id,
      date_updated: now(),
    }

    this.storage.set(`${this.prefix}${id}`, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new CloseError(`Contact not found: ${id}`, 'NOT_FOUND', 404)
    }
    this.storage.delete(`${this.prefix}${id}`)
  }

  async list(options?: ListOptions & { lead_id?: string }): Promise<CloseResponse<Contact>> {
    let all = this.getAll()

    if (options?.lead_id) {
      all = all.filter((c) => c.lead_id === options.lead_id)
    }

    const skip = options?._skip ?? 0
    const limit = options?._limit ?? 100
    const paged = all.slice(skip, skip + limit)

    return {
      data: paged,
      has_more: skip + limit < all.length,
    }
  }
}

class OpportunitiesResource {
  private storage: CloseStorage
  private prefix = 'close:opp:'
  private defaultStatusId: string

  constructor(storage: CloseStorage, defaultStatusId: string) {
    this.storage = storage
    this.defaultStatusId = defaultStatusId
  }

  private getAll(): Opportunity[] {
    const opps: Opportunity[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const opp = this.storage.get<Opportunity>(key)
        if (opp) {
          opps.push(opp)
        }
      }
    }
    return opps
  }

  async create(input: OpportunityCreateInput): Promise<Opportunity> {
    const id = generateId('oppo')
    const timestamp = now()

    const opp: Opportunity = {
      id,
      lead_id: input.lead_id,
      contact_id: input.contact_id,
      status_id: input.status_id ?? this.defaultStatusId,
      note: input.note,
      value: input.value,
      value_period: input.value_period ?? 'one_time',
      value_currency: input.value_currency ?? 'USD',
      expected_value: input.expected_value,
      confidence: input.confidence,
      custom: input.custom,
      date_created: timestamp,
      date_updated: timestamp,
    }

    this.storage.set(`${this.prefix}${id}`, opp)
    return opp
  }

  async get(id: string): Promise<Opportunity | null> {
    return this.storage.get<Opportunity>(`${this.prefix}${id}`) ?? null
  }

  async update(id: string, input: OpportunityUpdateInput): Promise<Opportunity> {
    const existing = await this.get(id)
    if (!existing) {
      throw new CloseError(`Opportunity not found: ${id}`, 'NOT_FOUND', 404)
    }

    const updated: Opportunity = {
      ...existing,
      ...input,
      id,
      date_updated: now(),
    }

    this.storage.set(`${this.prefix}${id}`, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new CloseError(`Opportunity not found: ${id}`, 'NOT_FOUND', 404)
    }
    this.storage.delete(`${this.prefix}${id}`)
  }

  async list(options?: ListOptions & { lead_id?: string }): Promise<CloseResponse<Opportunity>> {
    let all = this.getAll()

    if (options?.lead_id) {
      all = all.filter((o) => o.lead_id === options.lead_id)
    }

    const skip = options?._skip ?? 0
    const limit = options?._limit ?? 100
    const paged = all.slice(skip, skip + limit)

    return {
      data: paged,
      has_more: skip + limit < all.length,
    }
  }
}

class ActivitiesResource {
  private storage: CloseStorage
  private emailPrefix = 'close:email:'
  private callPrefix = 'close:call:'
  private smsPrefix = 'close:sms:'
  private notePrefix = 'close:note:'
  private meetingPrefix = 'close:meeting:'

  constructor(storage: CloseStorage) {
    this.storage = storage
  }

  async createEmail(input: EmailCreateInput): Promise<EmailActivity> {
    const id = generateId('acti')
    const timestamp = now()

    const email: EmailActivity = {
      id,
      _type: 'Email',
      lead_id: input.lead_id,
      contact_id: input.contact_id,
      subject: input.subject,
      body_text: input.body_text,
      body_html: input.body_html,
      direction: input.direction,
      status: input.status,
      sender: input.sender,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      date_created: timestamp,
      date_updated: timestamp,
    }

    this.storage.set(`${this.emailPrefix}${id}`, email)
    return email
  }

  async createCall(input: CallCreateInput): Promise<CallActivity> {
    const id = generateId('acti')
    const timestamp = now()

    const call: CallActivity = {
      id,
      _type: 'Call',
      lead_id: input.lead_id,
      contact_id: input.contact_id,
      direction: input.direction,
      duration: input.duration,
      note: input.note,
      disposition: input.disposition,
      phone: input.phone,
      date_created: timestamp,
      date_updated: timestamp,
    }

    this.storage.set(`${this.callPrefix}${id}`, call)
    return call
  }

  async createSMS(input: SMSCreateInput): Promise<SMSActivity> {
    const id = generateId('acti')
    const timestamp = now()

    const sms: SMSActivity = {
      id,
      _type: 'SMS',
      lead_id: input.lead_id,
      contact_id: input.contact_id,
      direction: input.direction,
      text: input.text,
      status: input.status,
      local_phone: input.local_phone,
      remote_phone: input.remote_phone,
      date_created: timestamp,
      date_updated: timestamp,
    }

    this.storage.set(`${this.smsPrefix}${id}`, sms)
    return sms
  }

  async createNote(input: NoteCreateInput): Promise<NoteActivity> {
    const id = generateId('acti')
    const timestamp = now()

    const note: NoteActivity = {
      id,
      _type: 'Note',
      lead_id: input.lead_id,
      contact_id: input.contact_id,
      note: input.note,
      date_created: timestamp,
      date_updated: timestamp,
    }

    this.storage.set(`${this.notePrefix}${id}`, note)
    return note
  }

  async createMeeting(input: MeetingCreateInput): Promise<MeetingActivity> {
    const id = generateId('acti')
    const timestamp = now()

    const meeting: MeetingActivity = {
      id,
      _type: 'Meeting',
      lead_id: input.lead_id,
      contact_id: input.contact_id,
      title: input.title,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      duration: input.duration,
      location: input.location,
      note: input.note,
      attendees: input.attendees?.map((a) => ({ ...a, is_organizer: false })),
      date_created: timestamp,
      date_updated: timestamp,
    }

    this.storage.set(`${this.meetingPrefix}${id}`, meeting)
    return meeting
  }

  async listEmails(options?: ListOptions & { lead_id?: string }): Promise<CloseResponse<EmailActivity>> {
    const emails: EmailActivity[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.emailPrefix)) {
        const email = this.storage.get<EmailActivity>(key)
        if (email) {
          if (!options?.lead_id || email.lead_id === options.lead_id) {
            emails.push(email)
          }
        }
      }
    }

    const skip = options?._skip ?? 0
    const limit = options?._limit ?? 100
    const paged = emails.slice(skip, skip + limit)

    return {
      data: paged,
      has_more: skip + limit < emails.length,
    }
  }

  async listCalls(options?: ListOptions & { lead_id?: string }): Promise<CloseResponse<CallActivity>> {
    const calls: CallActivity[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.callPrefix)) {
        const call = this.storage.get<CallActivity>(key)
        if (call) {
          if (!options?.lead_id || call.lead_id === options.lead_id) {
            calls.push(call)
          }
        }
      }
    }

    const skip = options?._skip ?? 0
    const limit = options?._limit ?? 100
    const paged = calls.slice(skip, skip + limit)

    return {
      data: paged,
      has_more: skip + limit < calls.length,
    }
  }

  async listNotes(options?: ListOptions & { lead_id?: string }): Promise<CloseResponse<NoteActivity>> {
    const notes: NoteActivity[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.notePrefix)) {
        const note = this.storage.get<NoteActivity>(key)
        if (note) {
          if (!options?.lead_id || note.lead_id === options.lead_id) {
            notes.push(note)
          }
        }
      }
    }

    const skip = options?._skip ?? 0
    const limit = options?._limit ?? 100
    const paged = notes.slice(skip, skip + limit)

    return {
      data: paged,
      has_more: skip + limit < notes.length,
    }
  }

  async list(options?: ListOptions & { lead_id?: string }): Promise<CloseResponse<Activity>> {
    const activities: Activity[] = []

    // Collect all activity types
    for (const key of this.storage.keys()) {
      if (
        key.startsWith(this.emailPrefix) ||
        key.startsWith(this.callPrefix) ||
        key.startsWith(this.smsPrefix) ||
        key.startsWith(this.notePrefix) ||
        key.startsWith(this.meetingPrefix)
      ) {
        const activity = this.storage.get<Activity>(key)
        if (activity) {
          if (!options?.lead_id || activity.lead_id === options.lead_id) {
            activities.push(activity)
          }
        }
      }
    }

    // Sort by date_created descending
    activities.sort((a, b) => b.date_created.localeCompare(a.date_created))

    const skip = options?._skip ?? 0
    const limit = options?._limit ?? 100
    const paged = activities.slice(skip, skip + limit)

    return {
      data: paged,
      has_more: skip + limit < activities.length,
    }
  }
}

class TasksResource {
  private storage: CloseStorage
  private prefix = 'close:task:'

  constructor(storage: CloseStorage) {
    this.storage = storage
  }

  private getAll(): Task[] {
    const tasks: Task[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const task = this.storage.get<Task>(key)
        if (task) {
          tasks.push(task)
        }
      }
    }
    return tasks
  }

  async create(input: TaskCreateInput): Promise<Task> {
    const id = generateId('task')
    const timestamp = now()

    const task: Task = {
      id,
      lead_id: input.lead_id,
      text: input.text,
      date: input.date,
      due_date: input.date,
      assigned_to: input.assigned_to,
      is_complete: false,
      is_dateless: input.is_dateless ?? !input.date,
      date_created: timestamp,
      date_updated: timestamp,
    }

    this.storage.set(`${this.prefix}${id}`, task)
    return task
  }

  async get(id: string): Promise<Task | null> {
    return this.storage.get<Task>(`${this.prefix}${id}`) ?? null
  }

  async update(id: string, input: TaskUpdateInput): Promise<Task> {
    const existing = await this.get(id)
    if (!existing) {
      throw new CloseError(`Task not found: ${id}`, 'NOT_FOUND', 404)
    }

    const updated: Task = {
      ...existing,
      ...input,
      id,
      date_updated: now(),
    }

    this.storage.set(`${this.prefix}${id}`, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new CloseError(`Task not found: ${id}`, 'NOT_FOUND', 404)
    }
    this.storage.delete(`${this.prefix}${id}`)
  }

  async list(
    options?: ListOptions & { lead_id?: string; is_complete?: boolean }
  ): Promise<CloseResponse<Task>> {
    let all = this.getAll()

    if (options?.lead_id) {
      all = all.filter((t) => t.lead_id === options.lead_id)
    }
    if (options?.is_complete !== undefined) {
      all = all.filter((t) => t.is_complete === options.is_complete)
    }

    const skip = options?._skip ?? 0
    const limit = options?._limit ?? 100
    const paged = all.slice(skip, skip + limit)

    return {
      data: paged,
      has_more: skip + limit < all.length,
    }
  }
}

class StatusesResource {
  private storage: CloseStorage
  private leadStatusPrefix = 'close:leadstatus:'
  private oppStatusPrefix = 'close:oppstatus:'

  constructor(storage: CloseStorage) {
    this.storage = storage
    this.initializeDefaultStatuses()
  }

  private initializeDefaultStatuses(): void {
    // Default lead statuses
    const defaultLeadStatuses = [
      { id: 'stat_potential', label: 'Potential' },
      { id: 'stat_badfit', label: 'Bad Fit' },
      { id: 'stat_qualified', label: 'Qualified' },
    ]

    for (const status of defaultLeadStatuses) {
      if (!this.storage.get(`${this.leadStatusPrefix}${status.id}`)) {
        this.storage.set(`${this.leadStatusPrefix}${status.id}`, status)
      }
    }

    // Default opportunity statuses
    const defaultOppStatuses: OpportunityStatus[] = [
      { id: 'stat_active', label: 'Active', type: 'active' },
      { id: 'stat_won', label: 'Won', type: 'won' },
      { id: 'stat_lost', label: 'Lost', type: 'lost' },
    ]

    for (const status of defaultOppStatuses) {
      if (!this.storage.get(`${this.oppStatusPrefix}${status.id}`)) {
        this.storage.set(`${this.oppStatusPrefix}${status.id}`, status)
      }
    }
  }

  async listLeadStatuses(): Promise<CloseResponse<Status>> {
    const statuses: Status[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.leadStatusPrefix)) {
        const status = this.storage.get<Status>(key)
        if (status) {
          statuses.push(status)
        }
      }
    }

    return {
      data: statuses,
      has_more: false,
    }
  }

  async createLeadStatus(input: StatusCreateInput): Promise<Status> {
    const id = generateId('stat')
    const status: Status = {
      id,
      label: input.label,
    }

    this.storage.set(`${this.leadStatusPrefix}${id}`, status)
    return status
  }

  async listOpportunityStatuses(): Promise<CloseResponse<OpportunityStatus>> {
    const statuses: OpportunityStatus[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.oppStatusPrefix)) {
        const status = this.storage.get<OpportunityStatus>(key)
        if (status) {
          statuses.push(status)
        }
      }
    }

    return {
      data: statuses,
      has_more: false,
    }
  }

  async createOpportunityStatus(input: OpportunityStatusCreateInput): Promise<OpportunityStatus> {
    const id = generateId('stat')
    const status: OpportunityStatus = {
      id,
      label: input.label,
      type: input.type,
    }

    this.storage.set(`${this.oppStatusPrefix}${id}`, status)
    return status
  }
}

class SmartViewsResource {
  private storage: CloseStorage
  private prefix = 'close:smartview:'

  constructor(storage: CloseStorage) {
    this.storage = storage
  }

  private getAll(): SmartView[] {
    const views: SmartView[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const view = this.storage.get<SmartView>(key)
        if (view) {
          views.push(view)
        }
      }
    }
    return views
  }

  async create(input: SmartViewCreateInput): Promise<SmartView> {
    const id = generateId('save')
    const timestamp = now()

    const view: SmartView = {
      id,
      name: input.name,
      type: input.type,
      query: input.query,
      date_created: timestamp,
      date_updated: timestamp,
    }

    this.storage.set(`${this.prefix}${id}`, view)
    return view
  }

  async get(id: string): Promise<SmartView | null> {
    return this.storage.get<SmartView>(`${this.prefix}${id}`) ?? null
  }

  async list(): Promise<CloseResponse<SmartView>> {
    return {
      data: this.getAll(),
      has_more: false,
    }
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new CloseError(`Smart View not found: ${id}`, 'NOT_FOUND', 404)
    }
    this.storage.delete(`${this.prefix}${id}`)
  }
}

class CustomFieldsResource {
  private storage: CloseStorage
  private prefix = 'close:customfield:'

  constructor(storage: CloseStorage) {
    this.storage = storage
  }

  private getAll(): CustomField[] {
    const fields: CustomField[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const field = this.storage.get<CustomField>(key)
        if (field) {
          fields.push(field)
        }
      }
    }
    return fields
  }

  async create(input: CustomFieldCreateInput): Promise<CustomField> {
    const id = generateId('cf')
    const timestamp = now()

    const field: CustomField = {
      id,
      name: input.name,
      type: input.type,
      object_type: input.object_type,
      choices: input.choices,
      date_created: timestamp,
      date_updated: timestamp,
    }

    this.storage.set(`${this.prefix}${id}`, field)
    return field
  }

  async list(): Promise<CloseResponse<CustomField>> {
    return {
      data: this.getAll(),
      has_more: false,
    }
  }
}

// =============================================================================
// Main Client
// =============================================================================

export interface CloseClientOptions {
  storage: Map<string, unknown> | CloseStorage
  apiKey?: string
}

export class CloseClient {
  private storage: CloseStorage

  readonly leads: LeadsResource
  readonly contacts: ContactsResource
  readonly opportunities: OpportunitiesResource
  readonly activities: ActivitiesResource
  readonly tasks: TasksResource
  readonly statuses: StatusesResource
  readonly smartViews: SmartViewsResource
  readonly customFields: CustomFieldsResource

  constructor(options: CloseClientOptions) {
    // Adapt Map to storage interface if needed
    if (options.storage instanceof Map) {
      this.storage = new MapStorageAdapter(options.storage)
    } else {
      this.storage = options.storage
    }

    // Initialize statuses first to get default IDs
    this.statuses = new StatusesResource(this.storage)

    // Initialize resources
    this.leads = new LeadsResource(this.storage, 'stat_potential')
    this.contacts = new ContactsResource(this.storage)
    this.opportunities = new OpportunitiesResource(this.storage, 'stat_active')
    this.activities = new ActivitiesResource(this.storage)
    this.tasks = new TasksResource(this.storage)
    this.smartViews = new SmartViewsResource(this.storage)
    this.customFields = new CustomFieldsResource(this.storage)
  }
}

// =============================================================================
// Exports
// =============================================================================

export default CloseClient

// Re-export sequences module
export * from './sequences'
export { SequenceClient, SequenceError } from './sequences'
