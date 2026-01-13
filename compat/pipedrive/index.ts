/**
 * @dotdo/pipedrive - Pipedrive CRM Compatibility Layer
 *
 * Local implementation of Pipedrive APIs backed by DO storage.
 * Supports Persons, Organizations, Deals, Activities, Notes, Pipelines, and more.
 *
 * @example
 * ```typescript
 * import { PipedriveClient } from '@dotdo/pipedrive'
 *
 * const client = new PipedriveClient({ storage: ctx.storage })
 *
 * // Create a person
 * const person = await client.persons.create({
 *   name: 'John Doe',
 *   email: [{ value: 'john@example.com', primary: true }],
 * })
 *
 * // Create a deal
 * const deal = await client.deals.create({
 *   title: 'Enterprise Deal',
 *   value: 50000,
 *   person_id: person.id,
 * })
 * ```
 *
 * @module @dotdo/pipedrive
 */

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Email/Phone field format used by Pipedrive
 */
export interface EmailPhone {
  value: string
  primary?: boolean
  label?: string
}

/**
 * Person (Contact) entity
 */
export interface Person {
  id: number
  name: string
  first_name?: string
  last_name?: string
  email?: EmailPhone[]
  phone?: EmailPhone[]
  org_id?: number
  org_name?: string
  owner_id?: number
  open_deals_count?: number
  closed_deals_count?: number
  won_deals_count?: number
  lost_deals_count?: number
  label?: number
  active_flag: boolean
  add_time: string
  update_time: string
  [key: string]: unknown
}

/**
 * Organization entity
 */
export interface Organization {
  id: number
  name: string
  address?: string
  address_locality?: string
  address_country?: string
  address_postal_code?: string
  owner_id?: number
  people_count?: number
  open_deals_count?: number
  closed_deals_count?: number
  won_deals_count?: number
  lost_deals_count?: number
  label?: number
  active_flag: boolean
  add_time: string
  update_time: string
  [key: string]: unknown
}

/**
 * Deal entity
 */
export interface Deal {
  id: number
  title: string
  value?: number
  currency?: string
  status: 'open' | 'won' | 'lost' | 'deleted'
  stage_id?: number
  pipeline_id?: number
  person_id?: number
  org_id?: number
  owner_id?: number
  expected_close_date?: string
  probability?: number
  lost_reason?: string
  won_time?: string
  lost_time?: string
  close_time?: string
  products_count?: number
  activities_count?: number
  add_time: string
  update_time: string
  stage_change_time?: string
  next_activity_date?: string
  next_activity_time?: string
  next_activity_id?: number
  [key: string]: unknown
}

/**
 * Activity entity
 */
export interface Activity {
  id: number
  subject: string
  type: string
  due_date?: string
  due_time?: string
  duration?: string
  done: boolean
  marked_as_done_time?: string
  person_id?: number
  org_id?: number
  deal_id?: number
  lead_id?: string
  owner_id?: number
  note?: string
  public_description?: string
  add_time: string
  update_time: string
  [key: string]: unknown
}

/**
 * Note entity
 */
export interface Note {
  id: number
  content: string
  person_id?: number
  org_id?: number
  deal_id?: number
  lead_id?: string
  add_time: string
  update_time: string
  active_flag: boolean
  pinned_to_deal_flag?: boolean
  pinned_to_person_flag?: boolean
  pinned_to_organization_flag?: boolean
  [key: string]: unknown
}

/**
 * Pipeline entity
 */
export interface Pipeline {
  id: number
  name: string
  url_title?: string
  order_nr?: number
  active: boolean
  deal_probability?: boolean
  add_time: string
  update_time: string
  [key: string]: unknown
}

/**
 * Stage entity
 */
export interface Stage {
  id: number
  name: string
  pipeline_id: number
  order_nr?: number
  rotten_flag?: boolean
  rotten_days?: number
  deal_probability?: number
  active_flag: boolean
  add_time: string
  update_time: string
  [key: string]: unknown
}

/**
 * Filter entity
 */
export interface Filter {
  id: number
  name: string
  type: 'deals' | 'person' | 'org' | 'activity' | 'products'
  conditions: FilterConditions
  active_flag: boolean
  add_time: string
  update_time: string
}

export interface FilterConditions {
  glue: 'and' | 'or'
  conditions: Array<{
    glue?: 'and' | 'or'
    conditions?: Array<{
      object: string
      field_id: string
      operator: string
      value: unknown
    }>
  }>
}

/**
 * Product entity
 */
export interface Product {
  id: number
  name: string
  code?: string
  description?: string
  unit?: string
  unit_price?: number
  currency?: string
  active_flag: boolean
  add_time: string
  update_time: string
  [key: string]: unknown
}

/**
 * Deal product attachment
 */
export interface DealProduct {
  id: number
  deal_id: number
  product_id: number
  quantity: number
  item_price: number
  sum: number
  currency: string
  enabled_flag: boolean
  add_time: string
  [key: string]: unknown
}

/**
 * Activity type
 */
export interface ActivityType {
  id: number
  name: string
  key_string: string
  icon_key: string
  active_flag: boolean
  color?: string
  order_nr: number
  is_custom_flag: boolean
  add_time?: string
  update_time?: string
}

// =============================================================================
// Input Types
// =============================================================================

export interface PersonCreateInput {
  name: string
  first_name?: string
  last_name?: string
  email?: EmailPhone[]
  phone?: EmailPhone[]
  org_id?: number
  owner_id?: number
  label?: number
  [key: string]: unknown
}

export interface PersonUpdateInput {
  name?: string
  first_name?: string
  last_name?: string
  email?: EmailPhone[]
  phone?: EmailPhone[]
  org_id?: number
  owner_id?: number
  label?: number
  [key: string]: unknown
}

export interface OrganizationCreateInput {
  name: string
  address?: string
  owner_id?: number
  label?: number
  [key: string]: unknown
}

export interface OrganizationUpdateInput {
  name?: string
  address?: string
  owner_id?: number
  label?: number
  [key: string]: unknown
}

export interface DealCreateInput {
  title: string
  value?: number
  currency?: string
  person_id?: number
  org_id?: number
  stage_id?: number
  pipeline_id?: number
  owner_id?: number
  expected_close_date?: string
  probability?: number
  [key: string]: unknown
}

export interface DealUpdateInput {
  title?: string
  value?: number
  currency?: string
  status?: 'open' | 'won' | 'lost'
  stage_id?: number
  pipeline_id?: number
  person_id?: number
  org_id?: number
  owner_id?: number
  expected_close_date?: string
  probability?: number
  lost_reason?: string
  won_time?: string
  lost_time?: string
  [key: string]: unknown
}

export interface ActivityCreateInput {
  subject: string
  type: string
  due_date?: string
  due_time?: string
  duration?: string
  person_id?: number
  org_id?: number
  deal_id?: number
  lead_id?: string
  owner_id?: number
  note?: string
  done?: boolean
  [key: string]: unknown
}

export interface ActivityUpdateInput {
  subject?: string
  type?: string
  due_date?: string
  due_time?: string
  duration?: string
  person_id?: number
  org_id?: number
  deal_id?: number
  lead_id?: string
  owner_id?: number
  note?: string
  done?: boolean
  [key: string]: unknown
}

export interface NoteCreateInput {
  content: string
  person_id?: number
  org_id?: number
  deal_id?: number
  lead_id?: string
  pinned_to_deal_flag?: boolean
  pinned_to_person_flag?: boolean
  pinned_to_organization_flag?: boolean
}

export interface NoteUpdateInput {
  content?: string
  pinned_to_deal_flag?: boolean
  pinned_to_person_flag?: boolean
  pinned_to_organization_flag?: boolean
}

export interface PipelineCreateInput {
  name: string
  deal_probability?: boolean
  order_nr?: number
  active?: boolean
}

export interface PipelineUpdateInput {
  name?: string
  deal_probability?: boolean
  order_nr?: number
  active?: boolean
}

export interface StageCreateInput {
  name: string
  pipeline_id: number
  order_nr?: number
  rotten_flag?: boolean
  rotten_days?: number
  deal_probability?: number
}

export interface StageUpdateInput {
  name?: string
  order_nr?: number
  rotten_flag?: boolean
  rotten_days?: number
  deal_probability?: number
}

export interface FilterCreateInput {
  name: string
  type: 'deals' | 'person' | 'org' | 'activity' | 'products'
  conditions: FilterConditions
}

export interface ProductCreateInput {
  name: string
  code?: string
  description?: string
  unit?: string
  unit_price?: number
  currency?: string
  active_flag?: boolean
}

export interface ProductAttachInput {
  quantity: number
  item_price: number
  discount_percentage?: number
  duration?: number
  duration_unit?: string
  comments?: string
  enabled_flag?: boolean
}

// =============================================================================
// Response Types
// =============================================================================

export interface PipedriveResponse<T> {
  success: boolean
  data: T
  additional_data?: {
    pagination?: {
      start: number
      limit: number
      more_items_in_collection: boolean
    }
  }
}

export interface SearchResponse<T> {
  success: boolean
  data: {
    items: T[]
  }
  additional_data?: {
    pagination?: {
      start: number
      limit: number
      more_items_in_collection: boolean
    }
  }
}

export interface ListOptions {
  start?: number
  limit?: number
  sort?: string
}

// =============================================================================
// Error Class
// =============================================================================

export class PipedriveError extends Error {
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
    this.name = 'PipedriveError'
    this.errorCode = errorCode
    this.httpStatus = httpStatus
    this.details = details
  }
}

// =============================================================================
// Storage Interface
// =============================================================================

export interface PipedriveStorage {
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T): void
  delete(key: string): boolean
  keys(): IterableIterator<string>
}

// Map-based storage adapter
class MapStorageAdapter implements PipedriveStorage {
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

function generateId(): number {
  return Math.floor(Math.random() * 1000000) + Date.now() % 1000000
}

function now(): string {
  return new Date().toISOString()
}

function matchesSearch(item: Record<string, unknown>, term: string): boolean {
  const termLower = term.toLowerCase()
  for (const value of Object.values(item)) {
    if (typeof value === 'string' && value.toLowerCase().includes(termLower)) {
      return true
    }
    if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === 'object' && v !== null && 'value' in v) {
          const emailPhone = v as EmailPhone
          if (emailPhone.value?.toLowerCase().includes(termLower)) {
            return true
          }
        }
      }
    }
  }
  return false
}

// =============================================================================
// Resource Classes
// =============================================================================

class PersonsResource {
  private storage: PipedriveStorage
  private prefix = 'pipedrive:person:'

  constructor(storage: PipedriveStorage) {
    this.storage = storage
  }

  private getAll(): Person[] {
    const persons: Person[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const person = this.storage.get<Person>(key)
        if (person && person.active_flag !== false) {
          persons.push(person)
        }
      }
    }
    return persons
  }

  async create(input: PersonCreateInput): Promise<Person> {
    const id = generateId()
    const timestamp = now()

    const person: Person = {
      id,
      name: input.name,
      first_name: input.first_name,
      last_name: input.last_name,
      email: input.email,
      phone: input.phone,
      org_id: input.org_id,
      owner_id: input.owner_id,
      label: input.label,
      active_flag: true,
      open_deals_count: 0,
      closed_deals_count: 0,
      won_deals_count: 0,
      lost_deals_count: 0,
      add_time: timestamp,
      update_time: timestamp,
      ...input,
    }

    this.storage.set(`${this.prefix}${id}`, person)
    return person
  }

  async get(id: number): Promise<Person | null> {
    const person = this.storage.get<Person>(`${this.prefix}${id}`)
    if (!person || person.active_flag === false) {
      return null
    }
    return person
  }

  async update(id: number, input: PersonUpdateInput): Promise<Person> {
    const existing = await this.get(id)
    if (!existing) {
      throw new PipedriveError(`Person not found: ${id}`, 'NOT_FOUND', 404)
    }

    const updated: Person = {
      ...existing,
      ...input,
      id,
      update_time: now(),
    }

    this.storage.set(`${this.prefix}${id}`, updated)
    return updated
  }

  async delete(id: number): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new PipedriveError(`Person not found: ${id}`, 'NOT_FOUND', 404)
    }
    this.storage.delete(`${this.prefix}${id}`)
  }

  async search(
    term: string,
    options?: ListOptions
  ): Promise<SearchResponse<{ item: Person }>> {
    const all = this.getAll()
    let filtered = term ? all.filter((p) => matchesSearch(p, term)) : all

    const start = options?.start ?? 0
    const limit = options?.limit ?? 100
    const paged = filtered.slice(start, start + limit)

    return {
      success: true,
      data: {
        items: paged.map((item) => ({ item })),
      },
      additional_data: {
        pagination: {
          start,
          limit,
          more_items_in_collection: start + limit < filtered.length,
        },
      },
    }
  }

  async list(options?: ListOptions): Promise<PipedriveResponse<Person[]>> {
    let all = this.getAll()

    // Sort
    if (options?.sort) {
      const [field, direction] = options.sort.split(' ')
      all.sort((a, b) => {
        const aVal = String(a[field] ?? '')
        const bVal = String(b[field] ?? '')
        const cmp = aVal.localeCompare(bVal)
        return direction === 'DESC' ? -cmp : cmp
      })
    }

    const start = options?.start ?? 0
    const limit = options?.limit ?? 100
    const paged = all.slice(start, start + limit)

    return {
      success: true,
      data: paged,
      additional_data: {
        pagination: {
          start,
          limit,
          more_items_in_collection: start + limit < all.length,
        },
      },
    }
  }
}

class OrganizationsResource {
  private storage: PipedriveStorage
  private prefix = 'pipedrive:org:'

  constructor(storage: PipedriveStorage) {
    this.storage = storage
  }

  private getAll(): Organization[] {
    const orgs: Organization[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const org = this.storage.get<Organization>(key)
        if (org && org.active_flag !== false) {
          orgs.push(org)
        }
      }
    }
    return orgs
  }

  async create(input: OrganizationCreateInput): Promise<Organization> {
    const id = generateId()
    const timestamp = now()

    const org: Organization = {
      id,
      name: input.name,
      address: input.address,
      owner_id: input.owner_id,
      label: input.label,
      active_flag: true,
      people_count: 0,
      open_deals_count: 0,
      closed_deals_count: 0,
      won_deals_count: 0,
      lost_deals_count: 0,
      add_time: timestamp,
      update_time: timestamp,
      ...input,
    }

    this.storage.set(`${this.prefix}${id}`, org)
    return org
  }

  async get(id: number): Promise<Organization | null> {
    const org = this.storage.get<Organization>(`${this.prefix}${id}`)
    if (!org || org.active_flag === false) {
      return null
    }
    return org
  }

  async update(id: number, input: OrganizationUpdateInput): Promise<Organization> {
    const existing = await this.get(id)
    if (!existing) {
      throw new PipedriveError(`Organization not found: ${id}`, 'NOT_FOUND', 404)
    }

    const updated: Organization = {
      ...existing,
      ...input,
      id,
      update_time: now(),
    }

    this.storage.set(`${this.prefix}${id}`, updated)
    return updated
  }

  async delete(id: number): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new PipedriveError(`Organization not found: ${id}`, 'NOT_FOUND', 404)
    }
    this.storage.delete(`${this.prefix}${id}`)
  }

  async search(
    term: string,
    options?: ListOptions
  ): Promise<SearchResponse<{ item: Organization }>> {
    const all = this.getAll()
    let filtered = term ? all.filter((o) => matchesSearch(o, term)) : all

    const start = options?.start ?? 0
    const limit = options?.limit ?? 100
    const paged = filtered.slice(start, start + limit)

    return {
      success: true,
      data: {
        items: paged.map((item) => ({ item })),
      },
      additional_data: {
        pagination: {
          start,
          limit,
          more_items_in_collection: start + limit < filtered.length,
        },
      },
    }
  }

  async list(options?: ListOptions): Promise<PipedriveResponse<Organization[]>> {
    const all = this.getAll()
    const start = options?.start ?? 0
    const limit = options?.limit ?? 100
    const paged = all.slice(start, start + limit)

    return {
      success: true,
      data: paged,
      additional_data: {
        pagination: {
          start,
          limit,
          more_items_in_collection: start + limit < all.length,
        },
      },
    }
  }

  async getPersons(orgId: number): Promise<PipedriveResponse<Person[]>> {
    const persons: Person[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith('pipedrive:person:')) {
        const person = this.storage.get<Person>(key)
        if (person && person.org_id === orgId && person.active_flag !== false) {
          persons.push(person)
        }
      }
    }

    return {
      success: true,
      data: persons,
    }
  }
}

class DealsResource {
  private storage: PipedriveStorage
  private prefix = 'pipedrive:deal:'

  constructor(storage: PipedriveStorage) {
    this.storage = storage
  }

  private getAll(): Deal[] {
    const deals: Deal[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const deal = this.storage.get<Deal>(key)
        if (deal && deal.status !== 'deleted') {
          deals.push(deal)
        }
      }
    }
    return deals
  }

  async create(input: DealCreateInput): Promise<Deal> {
    const id = generateId()
    const timestamp = now()

    const deal: Deal = {
      id,
      title: input.title,
      value: input.value,
      currency: input.currency ?? 'USD',
      status: 'open',
      stage_id: input.stage_id ?? 1,
      pipeline_id: input.pipeline_id ?? 1,
      person_id: input.person_id,
      org_id: input.org_id,
      owner_id: input.owner_id,
      expected_close_date: input.expected_close_date,
      probability: input.probability,
      products_count: 0,
      activities_count: 0,
      add_time: timestamp,
      update_time: timestamp,
      ...input,
    }

    this.storage.set(`${this.prefix}${id}`, deal)
    return deal
  }

  async get(id: number): Promise<Deal | null> {
    const deal = this.storage.get<Deal>(`${this.prefix}${id}`)
    if (!deal || deal.status === 'deleted') {
      return null
    }
    return deal
  }

  async update(id: number, input: DealUpdateInput): Promise<Deal> {
    const existing = await this.get(id)
    if (!existing) {
      throw new PipedriveError(`Deal not found: ${id}`, 'NOT_FOUND', 404)
    }

    const timestamp = now()
    const updated: Deal = {
      ...existing,
      ...input,
      id,
      update_time: timestamp,
    }

    // Handle stage change
    if (input.stage_id && input.stage_id !== existing.stage_id) {
      updated.stage_change_time = timestamp
    }

    // Handle status changes
    if (input.status === 'won' && existing.status !== 'won') {
      updated.close_time = timestamp
    } else if (input.status === 'lost' && existing.status !== 'lost') {
      updated.close_time = timestamp
    }

    this.storage.set(`${this.prefix}${id}`, updated)
    return updated
  }

  async delete(id: number): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new PipedriveError(`Deal not found: ${id}`, 'NOT_FOUND', 404)
    }
    this.storage.delete(`${this.prefix}${id}`)
  }

  async search(
    term: string,
    options?: ListOptions
  ): Promise<SearchResponse<{ item: Deal }>> {
    const all = this.getAll()
    let filtered = term ? all.filter((d) => matchesSearch(d, term)) : all

    const start = options?.start ?? 0
    const limit = options?.limit ?? 100
    const paged = filtered.slice(start, start + limit)

    return {
      success: true,
      data: {
        items: paged.map((item) => ({ item })),
      },
      additional_data: {
        pagination: {
          start,
          limit,
          more_items_in_collection: start + limit < filtered.length,
        },
      },
    }
  }

  async list(
    options?: ListOptions & { status?: 'open' | 'won' | 'lost' }
  ): Promise<PipedriveResponse<Deal[]>> {
    let all = this.getAll()

    if (options?.status) {
      all = all.filter((d) => d.status === options.status)
    }

    const start = options?.start ?? 0
    const limit = options?.limit ?? 100
    const paged = all.slice(start, start + limit)

    return {
      success: true,
      data: paged,
      additional_data: {
        pagination: {
          start,
          limit,
          more_items_in_collection: start + limit < all.length,
        },
      },
    }
  }

  async getSummary(): Promise<PipedriveResponse<{
    total_count: number
    total_currency_converted_value: number
    values_total: Record<string, number>
    open_deals_count: number
    won_deals_count: number
    lost_deals_count: number
  }>> {
    const all = this.getAll()
    const valuesTotal: Record<string, number> = {}

    for (const deal of all) {
      const currency = deal.currency ?? 'USD'
      valuesTotal[currency] = (valuesTotal[currency] ?? 0) + (deal.value ?? 0)
    }

    return {
      success: true,
      data: {
        total_count: all.length,
        total_currency_converted_value: Object.values(valuesTotal).reduce((a, b) => a + b, 0),
        values_total: valuesTotal,
        open_deals_count: all.filter((d) => d.status === 'open').length,
        won_deals_count: all.filter((d) => d.status === 'won').length,
        lost_deals_count: all.filter((d) => d.status === 'lost').length,
      },
    }
  }
}

class ActivitiesResource {
  private storage: PipedriveStorage
  private prefix = 'pipedrive:activity:'

  constructor(storage: PipedriveStorage) {
    this.storage = storage
  }

  private getAll(): Activity[] {
    const activities: Activity[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const activity = this.storage.get<Activity>(key)
        if (activity) {
          activities.push(activity)
        }
      }
    }
    return activities
  }

  async create(input: ActivityCreateInput): Promise<Activity> {
    const id = generateId()
    const timestamp = now()

    const activity: Activity = {
      id,
      subject: input.subject,
      type: input.type,
      due_date: input.due_date,
      due_time: input.due_time,
      duration: input.duration,
      done: input.done ?? false,
      person_id: input.person_id,
      org_id: input.org_id,
      deal_id: input.deal_id,
      lead_id: input.lead_id,
      owner_id: input.owner_id,
      note: input.note,
      add_time: timestamp,
      update_time: timestamp,
      ...input,
    }

    this.storage.set(`${this.prefix}${id}`, activity)
    return activity
  }

  async get(id: number): Promise<Activity | null> {
    return this.storage.get<Activity>(`${this.prefix}${id}`) ?? null
  }

  async update(id: number, input: ActivityUpdateInput): Promise<Activity> {
    const existing = await this.get(id)
    if (!existing) {
      throw new PipedriveError(`Activity not found: ${id}`, 'NOT_FOUND', 404)
    }

    const timestamp = now()
    const updated: Activity = {
      ...existing,
      ...input,
      id,
      update_time: timestamp,
    }

    // Handle marking as done
    if (input.done === true && !existing.done) {
      updated.marked_as_done_time = timestamp
    }

    this.storage.set(`${this.prefix}${id}`, updated)
    return updated
  }

  async delete(id: number): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new PipedriveError(`Activity not found: ${id}`, 'NOT_FOUND', 404)
    }
    this.storage.delete(`${this.prefix}${id}`)
  }

  async list(
    options?: ListOptions & { type?: string; done?: boolean }
  ): Promise<PipedriveResponse<Activity[]>> {
    let all = this.getAll()

    if (options?.type) {
      all = all.filter((a) => a.type === options.type)
    }
    if (options?.done !== undefined) {
      all = all.filter((a) => a.done === options.done)
    }

    const start = options?.start ?? 0
    const limit = options?.limit ?? 100
    const paged = all.slice(start, start + limit)

    return {
      success: true,
      data: paged,
      additional_data: {
        pagination: {
          start,
          limit,
          more_items_in_collection: start + limit < all.length,
        },
      },
    }
  }

  async getTypes(): Promise<PipedriveResponse<ActivityType[]>> {
    const defaultTypes: ActivityType[] = [
      { id: 1, name: 'Call', key_string: 'call', icon_key: 'call', active_flag: true, order_nr: 1, is_custom_flag: false },
      { id: 2, name: 'Meeting', key_string: 'meeting', icon_key: 'meeting', active_flag: true, order_nr: 2, is_custom_flag: false },
      { id: 3, name: 'Task', key_string: 'task', icon_key: 'task', active_flag: true, order_nr: 3, is_custom_flag: false },
      { id: 4, name: 'Deadline', key_string: 'deadline', icon_key: 'deadline', active_flag: true, order_nr: 4, is_custom_flag: false },
      { id: 5, name: 'Email', key_string: 'email', icon_key: 'email', active_flag: true, order_nr: 5, is_custom_flag: false },
      { id: 6, name: 'Lunch', key_string: 'lunch', icon_key: 'lunch', active_flag: true, order_nr: 6, is_custom_flag: false },
    ]

    return {
      success: true,
      data: defaultTypes,
    }
  }
}

class NotesResource {
  private storage: PipedriveStorage
  private prefix = 'pipedrive:note:'

  constructor(storage: PipedriveStorage) {
    this.storage = storage
  }

  private getAll(): Note[] {
    const notes: Note[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const note = this.storage.get<Note>(key)
        if (note && note.active_flag !== false) {
          notes.push(note)
        }
      }
    }
    return notes
  }

  async create(input: NoteCreateInput): Promise<Note> {
    const id = generateId()
    const timestamp = now()

    const note: Note = {
      id,
      content: input.content,
      person_id: input.person_id,
      org_id: input.org_id,
      deal_id: input.deal_id,
      lead_id: input.lead_id,
      active_flag: true,
      pinned_to_deal_flag: input.pinned_to_deal_flag,
      pinned_to_person_flag: input.pinned_to_person_flag,
      pinned_to_organization_flag: input.pinned_to_organization_flag,
      add_time: timestamp,
      update_time: timestamp,
    }

    this.storage.set(`${this.prefix}${id}`, note)
    return note
  }

  async get(id: number): Promise<Note | null> {
    const note = this.storage.get<Note>(`${this.prefix}${id}`)
    if (!note || note.active_flag === false) {
      return null
    }
    return note
  }

  async update(id: number, input: NoteUpdateInput): Promise<Note> {
    const existing = await this.get(id)
    if (!existing) {
      throw new PipedriveError(`Note not found: ${id}`, 'NOT_FOUND', 404)
    }

    const updated: Note = {
      ...existing,
      ...input,
      id,
      update_time: now(),
    }

    this.storage.set(`${this.prefix}${id}`, updated)
    return updated
  }

  async delete(id: number): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new PipedriveError(`Note not found: ${id}`, 'NOT_FOUND', 404)
    }
    this.storage.delete(`${this.prefix}${id}`)
  }

  async list(
    options?: ListOptions & { deal_id?: number; person_id?: number; org_id?: number }
  ): Promise<PipedriveResponse<Note[]>> {
    let all = this.getAll()

    if (options?.deal_id) {
      all = all.filter((n) => n.deal_id === options.deal_id)
    }
    if (options?.person_id) {
      all = all.filter((n) => n.person_id === options.person_id)
    }
    if (options?.org_id) {
      all = all.filter((n) => n.org_id === options.org_id)
    }

    const start = options?.start ?? 0
    const limit = options?.limit ?? 100
    const paged = all.slice(start, start + limit)

    return {
      success: true,
      data: paged,
      additional_data: {
        pagination: {
          start,
          limit,
          more_items_in_collection: start + limit < all.length,
        },
      },
    }
  }
}

class PipelinesResource {
  private storage: PipedriveStorage
  private prefix = 'pipedrive:pipeline:'
  private dealsResource: DealsResource

  constructor(storage: PipedriveStorage, dealsResource: DealsResource) {
    this.storage = storage
    this.dealsResource = dealsResource
    this.initializeDefaultPipeline()
  }

  private initializeDefaultPipeline(): void {
    if (!this.storage.get(`${this.prefix}1`)) {
      const timestamp = now()
      this.storage.set(`${this.prefix}1`, {
        id: 1,
        name: 'Sales Pipeline',
        url_title: 'Sales_Pipeline',
        order_nr: 1,
        active: true,
        deal_probability: true,
        add_time: timestamp,
        update_time: timestamp,
      } as Pipeline)
    }
  }

  private getAll(): Pipeline[] {
    const pipelines: Pipeline[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const pipeline = this.storage.get<Pipeline>(key)
        if (pipeline && pipeline.active !== false) {
          pipelines.push(pipeline)
        }
      }
    }
    return pipelines
  }

  async list(): Promise<PipedriveResponse<Pipeline[]>> {
    return {
      success: true,
      data: this.getAll(),
    }
  }

  async get(id: number): Promise<Pipeline | null> {
    const pipeline = this.storage.get<Pipeline>(`${this.prefix}${id}`)
    if (!pipeline || pipeline.active === false) {
      return null
    }
    return pipeline
  }

  async create(input: PipelineCreateInput): Promise<Pipeline> {
    const id = generateId()
    const timestamp = now()

    const pipeline: Pipeline = {
      id,
      name: input.name,
      url_title: input.name.replace(/\s+/g, '_'),
      order_nr: input.order_nr ?? this.getAll().length + 1,
      active: input.active !== false,
      deal_probability: input.deal_probability ?? true,
      add_time: timestamp,
      update_time: timestamp,
    }

    this.storage.set(`${this.prefix}${id}`, pipeline)
    return pipeline
  }

  async update(id: number, input: PipelineUpdateInput): Promise<Pipeline> {
    const existing = await this.get(id)
    if (!existing) {
      throw new PipedriveError(`Pipeline not found: ${id}`, 'NOT_FOUND', 404)
    }

    const updated: Pipeline = {
      ...existing,
      ...input,
      id,
      update_time: now(),
    }

    this.storage.set(`${this.prefix}${id}`, updated)
    return updated
  }

  async delete(id: number): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new PipedriveError(`Pipeline not found: ${id}`, 'NOT_FOUND', 404)
    }
    this.storage.delete(`${this.prefix}${id}`)
  }

  async getDeals(pipelineId: number): Promise<PipedriveResponse<Deal[]>> {
    const result = await this.dealsResource.list()
    const filtered = result.data.filter((d) => d.pipeline_id === pipelineId)
    return {
      success: true,
      data: filtered,
    }
  }
}

class StagesResource {
  private storage: PipedriveStorage
  private prefix = 'pipedrive:stage:'
  private dealsResource: DealsResource

  constructor(storage: PipedriveStorage, dealsResource: DealsResource) {
    this.storage = storage
    this.dealsResource = dealsResource
    this.initializeDefaultStages()
  }

  private initializeDefaultStages(): void {
    const defaultStages = [
      { id: 1, name: 'Lead In', pipeline_id: 1, order_nr: 1, deal_probability: 10 },
      { id: 2, name: 'Contact Made', pipeline_id: 1, order_nr: 2, deal_probability: 25 },
      { id: 3, name: 'Proposal Made', pipeline_id: 1, order_nr: 3, deal_probability: 50 },
      { id: 4, name: 'Negotiations Started', pipeline_id: 1, order_nr: 4, deal_probability: 75 },
    ]

    const timestamp = now()
    for (const stage of defaultStages) {
      if (!this.storage.get(`${this.prefix}${stage.id}`)) {
        this.storage.set(`${this.prefix}${stage.id}`, {
          ...stage,
          active_flag: true,
          rotten_flag: false,
          add_time: timestamp,
          update_time: timestamp,
        } as Stage)
      }
    }
  }

  private getAll(): Stage[] {
    const stages: Stage[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const stage = this.storage.get<Stage>(key)
        if (stage && stage.active_flag !== false) {
          stages.push(stage)
        }
      }
    }
    return stages
  }

  async list(
    options?: { pipeline_id?: number }
  ): Promise<PipedriveResponse<Stage[]>> {
    let all = this.getAll()

    if (options?.pipeline_id) {
      all = all.filter((s) => s.pipeline_id === options.pipeline_id)
    }

    // Sort by order
    all.sort((a, b) => (a.order_nr ?? 0) - (b.order_nr ?? 0))

    return {
      success: true,
      data: all,
    }
  }

  async get(id: number): Promise<Stage | null> {
    const stage = this.storage.get<Stage>(`${this.prefix}${id}`)
    if (!stage || stage.active_flag === false) {
      return null
    }
    return stage
  }

  async create(input: StageCreateInput): Promise<Stage> {
    const id = generateId()
    const timestamp = now()

    const stage: Stage = {
      id,
      name: input.name,
      pipeline_id: input.pipeline_id,
      order_nr: input.order_nr ?? this.getAll().filter(s => s.pipeline_id === input.pipeline_id).length + 1,
      rotten_flag: input.rotten_flag ?? false,
      rotten_days: input.rotten_days,
      deal_probability: input.deal_probability,
      active_flag: true,
      add_time: timestamp,
      update_time: timestamp,
    }

    this.storage.set(`${this.prefix}${id}`, stage)
    return stage
  }

  async update(id: number, input: StageUpdateInput): Promise<Stage> {
    const existing = await this.get(id)
    if (!existing) {
      throw new PipedriveError(`Stage not found: ${id}`, 'NOT_FOUND', 404)
    }

    const updated: Stage = {
      ...existing,
      ...input,
      id,
      update_time: now(),
    }

    this.storage.set(`${this.prefix}${id}`, updated)
    return updated
  }

  async delete(id: number): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new PipedriveError(`Stage not found: ${id}`, 'NOT_FOUND', 404)
    }
    this.storage.delete(`${this.prefix}${id}`)
  }

  async getDeals(stageId: number): Promise<PipedriveResponse<Deal[]>> {
    const result = await this.dealsResource.list()
    const filtered = result.data.filter((d) => d.stage_id === stageId)
    return {
      success: true,
      data: filtered,
    }
  }
}

class FiltersResource {
  private storage: PipedriveStorage
  private prefix = 'pipedrive:filter:'

  constructor(storage: PipedriveStorage) {
    this.storage = storage
  }

  private getAll(): Filter[] {
    const filters: Filter[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const filter = this.storage.get<Filter>(key)
        if (filter && filter.active_flag !== false) {
          filters.push(filter)
        }
      }
    }
    return filters
  }

  async create(input: FilterCreateInput): Promise<Filter> {
    const id = generateId()
    const timestamp = now()

    const filter: Filter = {
      id,
      name: input.name,
      type: input.type,
      conditions: input.conditions,
      active_flag: true,
      add_time: timestamp,
      update_time: timestamp,
    }

    this.storage.set(`${this.prefix}${id}`, filter)
    return filter
  }

  async get(id: number): Promise<Filter | null> {
    const filter = this.storage.get<Filter>(`${this.prefix}${id}`)
    if (!filter || filter.active_flag === false) {
      return null
    }
    return filter
  }

  async list(options?: { type?: string }): Promise<PipedriveResponse<Filter[]>> {
    let all = this.getAll()

    if (options?.type) {
      all = all.filter((f) => f.type === options.type)
    }

    return {
      success: true,
      data: all,
    }
  }

  async delete(id: number): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new PipedriveError(`Filter not found: ${id}`, 'NOT_FOUND', 404)
    }
    this.storage.delete(`${this.prefix}${id}`)
  }
}

class ProductsResource {
  private storage: PipedriveStorage
  private prefix = 'pipedrive:product:'
  private dealProductPrefix = 'pipedrive:dealproduct:'

  constructor(storage: PipedriveStorage) {
    this.storage = storage
  }

  private getAll(): Product[] {
    const products: Product[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const product = this.storage.get<Product>(key)
        if (product && product.active_flag !== false) {
          products.push(product)
        }
      }
    }
    return products
  }

  async create(input: ProductCreateInput): Promise<Product> {
    const id = generateId()
    const timestamp = now()

    const product: Product = {
      id,
      name: input.name,
      code: input.code,
      description: input.description,
      unit: input.unit,
      unit_price: input.unit_price,
      currency: input.currency ?? 'USD',
      active_flag: input.active_flag !== false,
      add_time: timestamp,
      update_time: timestamp,
    }

    this.storage.set(`${this.prefix}${id}`, product)
    return product
  }

  async get(id: number): Promise<Product | null> {
    const product = this.storage.get<Product>(`${this.prefix}${id}`)
    if (!product || product.active_flag === false) {
      return null
    }
    return product
  }

  async list(options?: ListOptions): Promise<PipedriveResponse<Product[]>> {
    const all = this.getAll()
    const start = options?.start ?? 0
    const limit = options?.limit ?? 100
    const paged = all.slice(start, start + limit)

    return {
      success: true,
      data: paged,
      additional_data: {
        pagination: {
          start,
          limit,
          more_items_in_collection: start + limit < all.length,
        },
      },
    }
  }

  async attachToDeal(
    dealId: number,
    productId: number,
    input: ProductAttachInput
  ): Promise<DealProduct> {
    const id = generateId()
    const timestamp = now()

    const dealProduct: DealProduct = {
      id,
      deal_id: dealId,
      product_id: productId,
      quantity: input.quantity,
      item_price: input.item_price,
      sum: input.quantity * input.item_price,
      currency: 'USD',
      enabled_flag: input.enabled_flag !== false,
      add_time: timestamp,
    }

    this.storage.set(`${this.dealProductPrefix}${id}`, dealProduct)
    return dealProduct
  }
}

// =============================================================================
// Main Client
// =============================================================================

export interface PipedriveClientOptions {
  storage: Map<string, unknown> | PipedriveStorage
  apiToken?: string
}

export class PipedriveClient {
  private storage: PipedriveStorage

  readonly persons: PersonsResource
  readonly organizations: OrganizationsResource
  readonly deals: DealsResource
  readonly activities: ActivitiesResource
  readonly notes: NotesResource
  readonly pipelines: PipelinesResource
  readonly stages: StagesResource
  readonly filters: FiltersResource
  readonly products: ProductsResource

  constructor(options: PipedriveClientOptions) {
    // Adapt Map to storage interface if needed
    if (options.storage instanceof Map) {
      this.storage = new MapStorageAdapter(options.storage)
    } else {
      this.storage = options.storage
    }

    // Initialize resources
    this.persons = new PersonsResource(this.storage)
    this.organizations = new OrganizationsResource(this.storage)
    this.deals = new DealsResource(this.storage)
    this.activities = new ActivitiesResource(this.storage)
    this.notes = new NotesResource(this.storage)
    this.pipelines = new PipelinesResource(this.storage, this.deals)
    this.stages = new StagesResource(this.storage, this.deals)
    this.filters = new FiltersResource(this.storage)
    this.products = new ProductsResource(this.storage)
  }
}

// =============================================================================
// Exports
// =============================================================================

export default PipedriveClient
