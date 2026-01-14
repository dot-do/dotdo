/**
 * @dotdo/crm - Unified CRM Compatibility Layer
 *
 * Provides a unified interface for working with multiple CRM providers:
 * - Salesforce
 * - HubSpot
 * - Pipedrive
 * - Close
 *
 * @example
 * ```typescript
 * import { createCRMAdapter } from '@dotdo/crm'
 * import { PipedriveClient } from '@dotdo/pipedrive'
 *
 * // Create provider-specific client
 * const pipedrive = new PipedriveClient({ storage })
 *
 * // Wrap in unified adapter
 * const crm = createCRMAdapter('pipedrive', pipedrive)
 *
 * // Now use unified interface
 * const contact = await crm.contacts.create({
 *   email: 'john@example.com',
 *   firstName: 'John',
 * })
 *
 * // Works the same with any provider
 * const deal = await crm.deals.create({
 *   name: 'Enterprise Deal',
 *   amount: 50000,
 *   stage: 'Proposal',
 * })
 * ```
 *
 * @module @dotdo/crm
 */

// =============================================================================
// Type Exports
// =============================================================================

export * from './types'

// =============================================================================
// Adapter Implementations
// =============================================================================

import type {
  CRMAdapter,
  CRMAdapterOptions,
  CRMCapabilities,
  CRMProvider,
  CRMProviderInfo,
  Contact,
  ContactCreateInput,
  ContactUpdateInput,
  Company,
  CompanyCreateInput,
  CompanyUpdateInput,
  Deal,
  DealCreateInput,
  DealUpdateInput,
  Pipeline,
  PipelineCreateInput,
  PipelineStage,
  Activity,
  ActivityCreateInput,
  ActivityUpdateInput,
  Note,
  NoteCreateInput,
  SearchOptions,
  SearchResult,
  ListResult,
  CRMError,
  CRMErrorCodes,
} from './types'

// =============================================================================
// Provider Capabilities
// =============================================================================

/**
 * Default capabilities for each provider
 */
export const PROVIDER_CAPABILITIES: Record<CRMProvider, CRMCapabilities> = {
  salesforce: {
    contacts: true,
    companies: true, // Accounts
    deals: true, // Opportunities
    pipelines: true,
    activities: true, // Tasks/Events
    notes: true,
    customFields: true,
    associations: true,
    bulkOperations: true,
    webhooks: true,
    search: true, // SOQL
  },
  hubspot: {
    contacts: true,
    companies: true,
    deals: true,
    pipelines: true,
    activities: true, // Engagements
    notes: true,
    customFields: true,
    associations: true,
    bulkOperations: true,
    webhooks: true,
    search: true,
  },
  pipedrive: {
    contacts: true, // Persons
    companies: true, // Organizations
    deals: true,
    pipelines: true,
    activities: true,
    notes: true,
    customFields: true,
    associations: true,
    bulkOperations: false,
    webhooks: true,
    search: true,
  },
  close: {
    contacts: true, // Contacts under Leads
    companies: true, // Leads (company-level)
    deals: true, // Opportunities
    pipelines: false, // Uses statuses instead
    activities: true, // Emails, Calls, SMS, Notes, Meetings
    notes: true,
    customFields: true,
    associations: true, // Lead-Contact relationships
    bulkOperations: true,
    webhooks: true,
    search: true,
  },
}

/**
 * Provider display names
 */
export const PROVIDER_NAMES: Record<CRMProvider, string> = {
  salesforce: 'Salesforce',
  hubspot: 'HubSpot',
  pipedrive: 'Pipedrive',
  close: 'Close',
}

// =============================================================================
// Base Adapter Class
// =============================================================================

/**
 * Abstract base class for CRM adapters
 *
 * Provides common functionality and default implementations.
 * Provider-specific adapters extend this class.
 */
export abstract class BaseCRMAdapter implements CRMAdapter {
  protected _client: unknown
  protected _provider: CRMProviderInfo

  constructor(
    providerType: CRMProvider,
    client: unknown,
    capabilities?: Partial<CRMCapabilities>
  ) {
    this._client = client
    this._provider = {
      provider: providerType,
      name: PROVIDER_NAMES[providerType],
      capabilities: {
        ...PROVIDER_CAPABILITIES[providerType],
        ...capabilities,
      },
    }
  }

  get provider(): CRMProviderInfo {
    return this._provider
  }

  getUnderlyingClient<T>(): T {
    return this._client as T
  }

  hasCapability(capability: keyof CRMCapabilities): boolean {
    return this._provider.capabilities[capability]
  }

  // Abstract methods that each adapter must implement
  abstract contacts: CRMAdapter['contacts']
  abstract companies: CRMAdapter['companies']
  abstract deals: CRMAdapter['deals']
  abstract pipelines: CRMAdapter['pipelines']
  abstract activities: CRMAdapter['activities']
  abstract notes: CRMAdapter['notes']
  abstract associations: CRMAdapter['associations']
}

// =============================================================================
// Pipedrive Adapter
// =============================================================================

import type { PipedriveClient } from '../pipedrive'

/**
 * Adapter for Pipedrive CRM
 *
 * Maps Pipedrive's Persons/Organizations/Deals to unified Contact/Company/Deal
 */
export class PipedriveAdapter extends BaseCRMAdapter {
  private pipedrive: PipedriveClient

  constructor(client: PipedriveClient) {
    super('pipedrive', client)
    this.pipedrive = client
  }

  contacts = {
    create: async (input: ContactCreateInput): Promise<Contact> => {
      const person = await this.pipedrive.persons.create({
        name: [input.firstName, input.lastName].filter(Boolean).join(' ') || input.email,
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email ? [{ value: input.email, primary: true }] : undefined,
        phone: input.phone ? [{ value: input.phone, primary: true }] : undefined,
        org_id: input.companyId ? parseInt(input.companyId) : undefined,
      })
      return this.mapPersonToContact(person)
    },

    get: async (id: string): Promise<Contact | null> => {
      const person = await this.pipedrive.persons.get(parseInt(id))
      return person ? this.mapPersonToContact(person) : null
    },

    update: async (id: string, input: ContactUpdateInput): Promise<Contact> => {
      const updates: Record<string, unknown> = {}
      if (input.firstName !== undefined || input.lastName !== undefined) {
        updates.name = [input.firstName, input.lastName].filter(Boolean).join(' ')
      }
      if (input.firstName !== undefined) updates.first_name = input.firstName
      if (input.lastName !== undefined) updates.last_name = input.lastName
      if (input.email !== undefined) updates.email = [{ value: input.email, primary: true }]
      if (input.phone !== undefined) updates.phone = [{ value: input.phone, primary: true }]
      if (input.companyId !== undefined) updates.org_id = parseInt(input.companyId)

      const person = await this.pipedrive.persons.update(parseInt(id), updates)
      return this.mapPersonToContact(person)
    },

    delete: async (id: string): Promise<void> => {
      await this.pipedrive.persons.delete(parseInt(id))
    },

    search: async (query: string, options?: SearchOptions): Promise<SearchResult<Contact>> => {
      const result = await this.pipedrive.persons.search(query, {
        start: options?.offset,
        limit: options?.limit,
      })
      return {
        total: result.data.items.length,
        results: result.data.items.map((item) => this.mapPersonToContact(item.item)),
        hasMore: result.additional_data?.pagination?.more_items_in_collection ?? false,
      }
    },

    list: async (options?: SearchOptions): Promise<ListResult<Contact>> => {
      const result = await this.pipedrive.persons.list({
        start: options?.offset,
        limit: options?.limit,
      })
      return {
        results: result.data.map((p) => this.mapPersonToContact(p)),
        hasMore: result.additional_data?.pagination?.more_items_in_collection ?? false,
      }
    },
  }

  companies = {
    create: async (input: CompanyCreateInput): Promise<Company> => {
      const org = await this.pipedrive.organizations.create({
        name: input.name,
        address: input.address?.street,
      })
      return this.mapOrgToCompany(org)
    },

    get: async (id: string): Promise<Company | null> => {
      const org = await this.pipedrive.organizations.get(parseInt(id))
      return org ? this.mapOrgToCompany(org) : null
    },

    update: async (id: string, input: CompanyUpdateInput): Promise<Company> => {
      const updates: Record<string, unknown> = {}
      if (input.name !== undefined) updates.name = input.name
      if (input.address?.street !== undefined) updates.address = input.address.street

      const org = await this.pipedrive.organizations.update(parseInt(id), updates)
      return this.mapOrgToCompany(org)
    },

    delete: async (id: string): Promise<void> => {
      await this.pipedrive.organizations.delete(parseInt(id))
    },

    search: async (query: string, options?: SearchOptions): Promise<SearchResult<Company>> => {
      const result = await this.pipedrive.organizations.search(query, {
        start: options?.offset,
        limit: options?.limit,
      })
      return {
        total: result.data.items.length,
        results: result.data.items.map((item) => this.mapOrgToCompany(item.item)),
        hasMore: result.additional_data?.pagination?.more_items_in_collection ?? false,
      }
    },

    list: async (options?: SearchOptions): Promise<ListResult<Company>> => {
      const result = await this.pipedrive.organizations.list({
        start: options?.offset,
        limit: options?.limit,
      })
      return {
        results: result.data.map((o) => this.mapOrgToCompany(o)),
        hasMore: result.additional_data?.pagination?.more_items_in_collection ?? false,
      }
    },
  }

  deals = {
    create: async (input: DealCreateInput): Promise<Deal> => {
      const deal = await this.pipedrive.deals.create({
        title: input.name,
        value: input.amount,
        currency: input.currency,
        person_id: input.contactIds?.[0] ? parseInt(input.contactIds[0]) : undefined,
        org_id: input.companyId ? parseInt(input.companyId) : undefined,
        expected_close_date: input.expectedCloseDate,
        probability: input.probability,
      })
      return this.mapDeal(deal)
    },

    get: async (id: string): Promise<Deal | null> => {
      const deal = await this.pipedrive.deals.get(parseInt(id))
      return deal ? this.mapDeal(deal) : null
    },

    update: async (id: string, input: DealUpdateInput): Promise<Deal> => {
      const updates: Record<string, unknown> = {}
      if (input.name !== undefined) updates.title = input.name
      if (input.amount !== undefined) updates.value = input.amount
      if (input.currency !== undefined) updates.currency = input.currency
      if (input.status !== undefined) updates.status = input.status
      if (input.stageId !== undefined) updates.stage_id = parseInt(input.stageId)
      if (input.expectedCloseDate !== undefined) updates.expected_close_date = input.expectedCloseDate
      if (input.probability !== undefined) updates.probability = input.probability
      if (input.lostReason !== undefined) updates.lost_reason = input.lostReason

      const deal = await this.pipedrive.deals.update(parseInt(id), updates)
      return this.mapDeal(deal)
    },

    delete: async (id: string): Promise<void> => {
      await this.pipedrive.deals.delete(parseInt(id))
    },

    search: async (query: string, options?: SearchOptions): Promise<SearchResult<Deal>> => {
      const result = await this.pipedrive.deals.search(query, {
        start: options?.offset,
        limit: options?.limit,
      })
      return {
        total: result.data.items.length,
        results: result.data.items.map((item) => this.mapDeal(item.item)),
        hasMore: result.additional_data?.pagination?.more_items_in_collection ?? false,
      }
    },

    list: async (options?: SearchOptions): Promise<ListResult<Deal>> => {
      const result = await this.pipedrive.deals.list({
        start: options?.offset,
        limit: options?.limit,
      })
      return {
        results: result.data.map((d) => this.mapDeal(d)),
        hasMore: result.additional_data?.pagination?.more_items_in_collection ?? false,
      }
    },

    moveToStage: async (dealId: string, stageId: string): Promise<Deal> => {
      const deal = await this.pipedrive.deals.update(parseInt(dealId), {
        stage_id: parseInt(stageId),
      })
      return this.mapDeal(deal)
    },
  }

  pipelines = {
    create: async (input: PipelineCreateInput): Promise<Pipeline> => {
      const pipeline = await this.pipedrive.pipelines.create({
        name: input.name,
      })
      // Get stages for this pipeline
      const stagesResult = await this.pipedrive.stages.list({ pipeline_id: pipeline.id })
      return this.mapPipeline(pipeline, stagesResult.data)
    },

    get: async (id: string): Promise<Pipeline | null> => {
      const pipeline = await this.pipedrive.pipelines.get(parseInt(id))
      if (!pipeline) return null
      const stagesResult = await this.pipedrive.stages.list({ pipeline_id: pipeline.id })
      return this.mapPipeline(pipeline, stagesResult.data)
    },

    list: async (): Promise<ListResult<Pipeline>> => {
      const result = await this.pipedrive.pipelines.list()
      const pipelines: Pipeline[] = []
      for (const p of result.data) {
        const stagesResult = await this.pipedrive.stages.list({ pipeline_id: p.id })
        pipelines.push(this.mapPipeline(p, stagesResult.data))
      }
      return {
        results: pipelines,
        hasMore: false,
      }
    },

    getDefault: async (): Promise<Pipeline | null> => {
      const result = await this.pipedrive.pipelines.list()
      if (result.data.length === 0) return null
      const pipeline = result.data[0]
      const stagesResult = await this.pipedrive.stages.list({ pipeline_id: pipeline.id })
      return this.mapPipeline(pipeline, stagesResult.data)
    },
  }

  activities = {
    create: async (input: ActivityCreateInput): Promise<Activity> => {
      const activity = await this.pipedrive.activities.create({
        subject: input.subject,
        type: input.type,
        due_date: input.dueDate,
        duration: input.duration ? `${input.duration}:00` : undefined,
        note: input.body,
        person_id: input.contactIds?.[0] ? parseInt(input.contactIds[0]) : undefined,
        org_id: input.companyId ? parseInt(input.companyId) : undefined,
        deal_id: input.dealId ? parseInt(input.dealId) : undefined,
      })
      return this.mapActivity(activity)
    },

    get: async (id: string): Promise<Activity | null> => {
      const activity = await this.pipedrive.activities.get(parseInt(id))
      return activity ? this.mapActivity(activity) : null
    },

    update: async (id: string, input: ActivityUpdateInput): Promise<Activity> => {
      const updates: Record<string, unknown> = {}
      if (input.subject !== undefined) updates.subject = input.subject
      if (input.body !== undefined) updates.note = input.body
      if (input.dueDate !== undefined) updates.due_date = input.dueDate
      if (input.duration !== undefined) updates.duration = `${input.duration}:00`
      if (input.status === 'completed') updates.done = true

      const activity = await this.pipedrive.activities.update(parseInt(id), updates)
      return this.mapActivity(activity)
    },

    delete: async (id: string): Promise<void> => {
      await this.pipedrive.activities.delete(parseInt(id))
    },

    list: async (options?: SearchOptions): Promise<ListResult<Activity>> => {
      const result = await this.pipedrive.activities.list({
        start: options?.offset,
        limit: options?.limit,
      })
      return {
        results: result.data.map((a) => this.mapActivity(a)),
        hasMore: result.additional_data?.pagination?.more_items_in_collection ?? false,
      }
    },

    listForContact: async (contactId: string): Promise<ListResult<Activity>> => {
      // Pipedrive doesn't have a direct filter, would need to iterate
      const result = await this.pipedrive.activities.list()
      const filtered = result.data.filter((a) => a.person_id === parseInt(contactId))
      return {
        results: filtered.map((a) => this.mapActivity(a)),
        hasMore: false,
      }
    },

    listForDeal: async (dealId: string): Promise<ListResult<Activity>> => {
      const result = await this.pipedrive.activities.list()
      const filtered = result.data.filter((a) => a.deal_id === parseInt(dealId))
      return {
        results: filtered.map((a) => this.mapActivity(a)),
        hasMore: false,
      }
    },

    complete: async (id: string): Promise<Activity> => {
      const activity = await this.pipedrive.activities.update(parseInt(id), { done: true })
      return this.mapActivity(activity)
    },
  }

  notes = {
    create: async (input: NoteCreateInput): Promise<Note> => {
      const note = await this.pipedrive.notes.create({
        content: input.content,
        person_id: input.contactId ? parseInt(input.contactId) : undefined,
        org_id: input.companyId ? parseInt(input.companyId) : undefined,
        deal_id: input.dealId ? parseInt(input.dealId) : undefined,
      })
      return this.mapNote(note)
    },

    get: async (id: string): Promise<Note | null> => {
      const note = await this.pipedrive.notes.get(parseInt(id))
      return note ? this.mapNote(note) : null
    },

    delete: async (id: string): Promise<void> => {
      await this.pipedrive.notes.delete(parseInt(id))
    },

    listForContact: async (contactId: string): Promise<ListResult<Note>> => {
      const result = await this.pipedrive.notes.list({ person_id: parseInt(contactId) })
      return {
        results: result.data.map((n) => this.mapNote(n)),
        hasMore: result.additional_data?.pagination?.more_items_in_collection ?? false,
      }
    },

    listForDeal: async (dealId: string): Promise<ListResult<Note>> => {
      const result = await this.pipedrive.notes.list({ deal_id: parseInt(dealId) })
      return {
        results: result.data.map((n) => this.mapNote(n)),
        hasMore: result.additional_data?.pagination?.more_items_in_collection ?? false,
      }
    },
  }

  associations = {
    associateContactToCompany: async (contactId: string, companyId: string): Promise<void> => {
      await this.pipedrive.persons.update(parseInt(contactId), {
        org_id: parseInt(companyId),
      })
    },

    associateContactToDeal: async (contactId: string, dealId: string): Promise<void> => {
      await this.pipedrive.deals.update(parseInt(dealId), {
        person_id: parseInt(contactId),
      })
    },

    associateDealToCompany: async (dealId: string, companyId: string): Promise<void> => {
      await this.pipedrive.deals.update(parseInt(dealId), {
        org_id: parseInt(companyId),
      })
    },

    disassociateContactFromCompany: async (_contactId: string, _companyId: string): Promise<void> => {
      // Pipedrive doesn't support disassociation easily
      // Would need to set org_id to null
    },

    disassociateContactFromDeal: async (_contactId: string, _dealId: string): Promise<void> => {
      // Would need to clear person_id on deal
    },

    disassociateDealFromCompany: async (_dealId: string, _companyId: string): Promise<void> => {
      // Would need to clear org_id on deal
    },
  }

  // Mapping helpers
  private mapPersonToContact(person: Record<string, unknown>): Contact {
    const emails = person.email as Array<{ value: string }> | undefined
    const phones = person.phone as Array<{ value: string }> | undefined

    return {
      id: String(person.id),
      email: emails?.[0]?.value,
      firstName: person.first_name as string | undefined,
      lastName: person.last_name as string | undefined,
      phone: phones?.[0]?.value,
      companyId: person.org_id ? String(person.org_id) : undefined,
      companyName: person.org_name as string | undefined,
      createdAt: person.add_time as string,
      updatedAt: person.update_time as string,
    }
  }

  private mapOrgToCompany(org: Record<string, unknown>): Company {
    return {
      id: String(org.id),
      name: org.name as string,
      address: org.address
        ? { street: org.address as string }
        : undefined,
      createdAt: org.add_time as string,
      updatedAt: org.update_time as string,
    }
  }

  private mapDeal(deal: Record<string, unknown>): Deal {
    return {
      id: String(deal.id),
      name: deal.title as string,
      amount: deal.value as number | undefined,
      currency: deal.currency as string | undefined,
      stage: '', // Would need to look up stage name
      stageId: deal.stage_id ? String(deal.stage_id) : undefined,
      pipelineId: deal.pipeline_id ? String(deal.pipeline_id) : undefined,
      probability: deal.probability as number | undefined,
      expectedCloseDate: deal.expected_close_date as string | undefined,
      status: (deal.status as 'open' | 'won' | 'lost') ?? 'open',
      lostReason: deal.lost_reason as string | undefined,
      companyId: deal.org_id ? String(deal.org_id) : undefined,
      contactIds: deal.person_id ? [String(deal.person_id)] : undefined,
      createdAt: deal.add_time as string,
      updatedAt: deal.update_time as string,
    }
  }

  private mapPipeline(
    pipeline: Record<string, unknown>,
    stages: Array<Record<string, unknown>>
  ): Pipeline {
    return {
      id: String(pipeline.id),
      name: pipeline.name as string,
      stages: stages.map((s) => ({
        id: String(s.id),
        name: s.name as string,
        orderIndex: (s.order_nr as number) ?? 0,
        probability: s.deal_probability as number | undefined,
      })),
      isDefault: pipeline.order_nr === 1,
      createdAt: pipeline.add_time as string,
      updatedAt: pipeline.update_time as string,
    }
  }

  private mapActivity(activity: Record<string, unknown>): Activity {
    return {
      id: String(activity.id),
      type: (activity.type as string) as Activity['type'],
      subject: activity.subject as string,
      body: activity.note as string | undefined,
      status: activity.done ? 'completed' : 'planned',
      dueDate: activity.due_date as string | undefined,
      contactIds: activity.person_id ? [String(activity.person_id)] : undefined,
      companyId: activity.org_id ? String(activity.org_id) : undefined,
      dealId: activity.deal_id ? String(activity.deal_id) : undefined,
      createdAt: activity.add_time as string,
      updatedAt: activity.update_time as string,
    }
  }

  private mapNote(note: Record<string, unknown>): Note {
    return {
      id: String(note.id),
      content: note.content as string,
      contactId: note.person_id ? String(note.person_id) : undefined,
      companyId: note.org_id ? String(note.org_id) : undefined,
      dealId: note.deal_id ? String(note.deal_id) : undefined,
      createdAt: note.add_time as string,
      updatedAt: note.update_time as string,
    }
  }
}

// =============================================================================
// Close Adapter
// =============================================================================

import type { CloseClient } from '../close'

/**
 * Adapter for Close CRM
 *
 * Close uses a Lead-centric model where Leads contain Contacts and Opportunities.
 * This adapter maps:
 * - Close Leads -> Companies (the organization level)
 * - Close Contacts -> Contacts (people within the Lead)
 * - Close Opportunities -> Deals
 */
export class CloseAdapter extends BaseCRMAdapter {
  private close: CloseClient

  constructor(client: CloseClient) {
    super('close', client)
    this.close = client
  }

  contacts = {
    create: async (input: ContactCreateInput): Promise<Contact> => {
      if (!input.companyId) {
        throw new Error('Close requires a companyId (lead_id) when creating contacts')
      }
      const contact = await this.close.contacts.create({
        lead_id: input.companyId,
        name: [input.firstName, input.lastName].filter(Boolean).join(' ') || input.email,
        title: input.title,
        emails: input.email ? [{ email: input.email, type: 'office' }] : undefined,
        phones: input.phone ? [{ phone: input.phone, type: 'office' }] : undefined,
      })
      return this.mapCloseContact(contact)
    },

    get: async (id: string): Promise<Contact | null> => {
      const contact = await this.close.contacts.get(id)
      return contact ? this.mapCloseContact(contact) : null
    },

    update: async (id: string, input: ContactUpdateInput): Promise<Contact> => {
      const updates: Record<string, unknown> = {}
      if (input.firstName !== undefined || input.lastName !== undefined) {
        updates.name = [input.firstName, input.lastName].filter(Boolean).join(' ')
      }
      if (input.title !== undefined) updates.title = input.title
      if (input.email !== undefined) updates.emails = [{ email: input.email, type: 'office' }]
      if (input.phone !== undefined) updates.phones = [{ phone: input.phone, type: 'office' }]

      const contact = await this.close.contacts.update(id, updates)
      return this.mapCloseContact(contact)
    },

    delete: async (id: string): Promise<void> => {
      await this.close.contacts.delete(id)
    },

    search: async (query: string, options?: SearchOptions): Promise<SearchResult<Contact>> => {
      // Close doesn't have direct contact search, search through leads
      const result = await this.close.contacts.list({
        _skip: options?.offset,
        _limit: options?.limit,
      })
      const filtered = result.data.filter((c) =>
        c.name?.toLowerCase().includes(query.toLowerCase())
      )
      return {
        total: filtered.length,
        results: filtered.map((c) => this.mapCloseContact(c)),
        hasMore: result.has_more,
      }
    },

    list: async (options?: SearchOptions): Promise<ListResult<Contact>> => {
      const result = await this.close.contacts.list({
        _skip: options?.offset,
        _limit: options?.limit,
      })
      return {
        results: result.data.map((c) => this.mapCloseContact(c)),
        hasMore: result.has_more,
      }
    },
  }

  companies = {
    create: async (input: CompanyCreateInput): Promise<Company> => {
      const lead = await this.close.leads.create({
        name: input.name,
        description: input.description,
        url: input.website,
        addresses: input.address
          ? [
              {
                address_1: input.address.street,
                city: input.address.city,
                state: input.address.state,
                zipcode: input.address.postalCode,
                country: input.address.country,
              },
            ]
          : undefined,
      })
      return this.mapLeadToCompany(lead)
    },

    get: async (id: string): Promise<Company | null> => {
      const lead = await this.close.leads.get(id)
      return lead ? this.mapLeadToCompany(lead) : null
    },

    update: async (id: string, input: CompanyUpdateInput): Promise<Company> => {
      const updates: Record<string, unknown> = {}
      if (input.name !== undefined) updates.name = input.name
      if (input.description !== undefined) updates.description = input.description
      if (input.website !== undefined) updates.url = input.website
      if (input.address !== undefined) {
        updates.addresses = [
          {
            address_1: input.address.street,
            city: input.address.city,
            state: input.address.state,
            zipcode: input.address.postalCode,
            country: input.address.country,
          },
        ]
      }

      const lead = await this.close.leads.update(id, updates)
      return this.mapLeadToCompany(lead)
    },

    delete: async (id: string): Promise<void> => {
      await this.close.leads.delete(id)
    },

    search: async (query: string, options?: SearchOptions): Promise<SearchResult<Company>> => {
      const result = await this.close.leads.search({
        query,
        _skip: options?.offset,
        _limit: options?.limit,
      })
      return {
        total: result.total_results ?? result.data.length,
        results: result.data.map((l) => this.mapLeadToCompany(l)),
        hasMore: result.has_more,
      }
    },

    list: async (options?: SearchOptions): Promise<ListResult<Company>> => {
      const result = await this.close.leads.list({
        _skip: options?.offset,
        _limit: options?.limit,
      })
      return {
        results: result.data.map((l) => this.mapLeadToCompany(l)),
        hasMore: result.has_more,
      }
    },
  }

  deals = {
    create: async (input: DealCreateInput): Promise<Deal> => {
      if (!input.companyId) {
        throw new Error('Close requires a companyId (lead_id) when creating opportunities')
      }
      const opp = await this.close.opportunities.create({
        lead_id: input.companyId,
        note: input.name,
        value: input.amount,
        value_currency: input.currency,
        confidence: input.probability,
        contact_id: input.contactIds?.[0],
      })
      return this.mapOpportunityToDeal(opp)
    },

    get: async (id: string): Promise<Deal | null> => {
      const opp = await this.close.opportunities.get(id)
      return opp ? this.mapOpportunityToDeal(opp) : null
    },

    update: async (id: string, input: DealUpdateInput): Promise<Deal> => {
      const updates: Record<string, unknown> = {}
      if (input.name !== undefined) updates.note = input.name
      if (input.amount !== undefined) updates.value = input.amount
      if (input.currency !== undefined) updates.value_currency = input.currency
      if (input.probability !== undefined) updates.confidence = input.probability
      if (input.status === 'won') {
        updates.status_id = 'stat_won'
        updates.date_won = new Date().toISOString()
      }
      if (input.status === 'lost') {
        updates.status_id = 'stat_lost'
        updates.date_lost = new Date().toISOString()
      }

      const opp = await this.close.opportunities.update(id, updates)
      return this.mapOpportunityToDeal(opp)
    },

    delete: async (id: string): Promise<void> => {
      await this.close.opportunities.delete(id)
    },

    search: async (query: string, options?: SearchOptions): Promise<SearchResult<Deal>> => {
      // Close doesn't have direct opportunity search
      const result = await this.close.opportunities.list({
        _skip: options?.offset,
        _limit: options?.limit,
      })
      const filtered = result.data.filter((o) =>
        o.note?.toLowerCase().includes(query.toLowerCase())
      )
      return {
        total: filtered.length,
        results: filtered.map((o) => this.mapOpportunityToDeal(o)),
        hasMore: result.has_more,
      }
    },

    list: async (options?: SearchOptions): Promise<ListResult<Deal>> => {
      const result = await this.close.opportunities.list({
        _skip: options?.offset,
        _limit: options?.limit,
      })
      return {
        results: result.data.map((o) => this.mapOpportunityToDeal(o)),
        hasMore: result.has_more,
      }
    },

    moveToStage: async (dealId: string, stageId: string): Promise<Deal> => {
      const opp = await this.close.opportunities.update(dealId, {
        status_id: stageId,
      })
      return this.mapOpportunityToDeal(opp)
    },
  }

  pipelines = {
    create: async (_input: PipelineCreateInput): Promise<Pipeline> => {
      // Close uses statuses, not pipelines
      throw new Error('Close does not support custom pipelines. Use opportunity statuses instead.')
    },

    get: async (_id: string): Promise<Pipeline | null> => {
      // Return opportunity statuses as a pseudo-pipeline
      const statuses = await this.close.statuses.listOpportunityStatuses()
      return {
        id: 'default',
        name: 'Opportunity Pipeline',
        stages: statuses.data.map((s, i) => ({
          id: s.id,
          name: s.label,
          orderIndex: i,
          isWon: s.type === 'won',
          isLost: s.type === 'lost',
        })),
        isDefault: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    },

    list: async (): Promise<ListResult<Pipeline>> => {
      const statuses = await this.close.statuses.listOpportunityStatuses()
      return {
        results: [
          {
            id: 'default',
            name: 'Opportunity Pipeline',
            stages: statuses.data.map((s, i) => ({
              id: s.id,
              name: s.label,
              orderIndex: i,
              isWon: s.type === 'won',
              isLost: s.type === 'lost',
            })),
            isDefault: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        hasMore: false,
      }
    },

    getDefault: async (): Promise<Pipeline | null> => {
      return this.pipelines.get('default')
    },
  }

  activities = {
    create: async (input: ActivityCreateInput): Promise<Activity> => {
      if (!input.companyId) {
        throw new Error('Close requires a companyId (lead_id) when creating activities')
      }

      let activity: Record<string, unknown>

      switch (input.type) {
        case 'call':
          activity = await this.close.activities.createCall({
            lead_id: input.companyId,
            contact_id: input.contactIds?.[0],
            direction: 'outbound',
            duration: input.duration ? input.duration * 60 : undefined,
            note: input.body,
          })
          break
        case 'email':
          activity = await this.close.activities.createEmail({
            lead_id: input.companyId,
            contact_id: input.contactIds?.[0],
            subject: input.subject,
            body_text: input.body,
            direction: 'outgoing',
            status: 'sent',
          })
          break
        case 'meeting':
          activity = await this.close.activities.createMeeting({
            lead_id: input.companyId,
            contact_id: input.contactIds?.[0],
            title: input.subject,
            starts_at: input.dueDate ?? new Date().toISOString(),
            duration: input.duration,
            note: input.body,
          })
          break
        case 'note':
        default:
          activity = await this.close.activities.createNote({
            lead_id: input.companyId,
            contact_id: input.contactIds?.[0],
            note: input.body ?? input.subject,
          })
          break
      }

      return this.mapCloseActivity(activity)
    },

    get: async (_id: string): Promise<Activity | null> => {
      // Close activities are created, not retrieved by ID easily
      return null
    },

    update: async (_id: string, _input: ActivityUpdateInput): Promise<Activity> => {
      throw new Error('Close does not support updating activities')
    },

    delete: async (_id: string): Promise<void> => {
      throw new Error('Close does not support deleting activities')
    },

    list: async (options?: SearchOptions): Promise<ListResult<Activity>> => {
      const result = await this.close.activities.list({
        _skip: options?.offset,
        _limit: options?.limit,
      })
      return {
        results: result.data.map((a) => this.mapCloseActivity(a)),
        hasMore: result.has_more,
      }
    },

    listForContact: async (contactId: string): Promise<ListResult<Activity>> => {
      const result = await this.close.activities.list()
      const filtered = result.data.filter((a) => a.contact_id === contactId)
      return {
        results: filtered.map((a) => this.mapCloseActivity(a)),
        hasMore: false,
      }
    },

    listForDeal: async (_dealId: string): Promise<ListResult<Activity>> => {
      // Close activities are on leads, not opportunities
      return { results: [], hasMore: false }
    },

    complete: async (_id: string): Promise<Activity> => {
      throw new Error('Close does not support completing activities')
    },
  }

  notes = {
    create: async (input: NoteCreateInput): Promise<Note> => {
      const companyId = input.companyId || input.dealId
      if (!companyId) {
        throw new Error('Close requires a companyId (lead_id) when creating notes')
      }

      const note = await this.close.activities.createNote({
        lead_id: companyId,
        contact_id: input.contactId,
        note: input.content,
      })

      return {
        id: note.id,
        content: note.note,
        contactId: note.contact_id,
        companyId: note.lead_id,
        createdAt: note.date_created,
        updatedAt: note.date_updated,
      }
    },

    get: async (_id: string): Promise<Note | null> => {
      return null
    },

    delete: async (_id: string): Promise<void> => {
      throw new Error('Close does not support deleting notes')
    },

    listForContact: async (contactId: string): Promise<ListResult<Note>> => {
      const result = await this.close.activities.listNotes()
      const filtered = result.data.filter((n) => n.contact_id === contactId)
      return {
        results: filtered.map((n) => ({
          id: n.id,
          content: n.note,
          contactId: n.contact_id,
          companyId: n.lead_id,
          createdAt: n.date_created,
          updatedAt: n.date_updated,
        })),
        hasMore: false,
      }
    },

    listForDeal: async (_dealId: string): Promise<ListResult<Note>> => {
      return { results: [], hasMore: false }
    },
  }

  associations = {
    associateContactToCompany: async (_contactId: string, _companyId: string): Promise<void> => {
      // In Close, contacts are always under leads (companies)
      // Would need to move the contact to a different lead
    },

    associateContactToDeal: async (contactId: string, dealId: string): Promise<void> => {
      await this.close.opportunities.update(dealId, { contact_id: contactId })
    },

    associateDealToCompany: async (_dealId: string, _companyId: string): Promise<void> => {
      // In Close, opportunities are always under leads
    },

    disassociateContactFromCompany: async (_contactId: string, _companyId: string): Promise<void> => {
      // Not supported in Close's model
    },

    disassociateContactFromDeal: async (_contactId: string, dealId: string): Promise<void> => {
      await this.close.opportunities.update(dealId, { contact_id: undefined })
    },

    disassociateDealFromCompany: async (_dealId: string, _companyId: string): Promise<void> => {
      // Not supported in Close's model
    },
  }

  // Mapping helpers
  private mapCloseContact(contact: Record<string, unknown>): Contact {
    const emails = contact.emails as Array<{ email: string }> | undefined
    const phones = contact.phones as Array<{ phone: string }> | undefined
    const nameParts = ((contact.name as string) ?? '').split(' ')

    return {
      id: contact.id as string,
      email: emails?.[0]?.email,
      firstName: nameParts[0],
      lastName: nameParts.slice(1).join(' '),
      phone: phones?.[0]?.phone,
      title: contact.title as string | undefined,
      companyId: contact.lead_id as string,
      createdAt: contact.date_created as string,
      updatedAt: contact.date_updated as string,
    }
  }

  private mapLeadToCompany(lead: Record<string, unknown>): Company {
    const addresses = lead.addresses as Array<Record<string, string>> | undefined
    const addr = addresses?.[0]

    return {
      id: lead.id as string,
      name: lead.name as string,
      description: lead.description as string | undefined,
      website: lead.url as string | undefined,
      address: addr
        ? {
            street: addr.address_1,
            city: addr.city,
            state: addr.state,
            postalCode: addr.zipcode,
            country: addr.country,
          }
        : undefined,
      createdAt: lead.date_created as string,
      updatedAt: lead.date_updated as string,
    }
  }

  private mapOpportunityToDeal(opp: Record<string, unknown>): Deal {
    let status: 'open' | 'won' | 'lost' = 'open'
    const statusType = opp.status_type as string | undefined
    if (statusType === 'won') status = 'won'
    if (statusType === 'lost') status = 'lost'

    return {
      id: opp.id as string,
      name: (opp.note as string) ?? 'Opportunity',
      amount: opp.value as number | undefined,
      currency: opp.value_currency as string | undefined,
      stage: opp.status_label as string ?? '',
      stageId: opp.status_id as string | undefined,
      probability: opp.confidence as number | undefined,
      expectedCloseDate: opp.date_won as string | undefined,
      actualCloseDate: (opp.date_won ?? opp.date_lost) as string | undefined,
      status,
      companyId: opp.lead_id as string,
      contactIds: opp.contact_id ? [opp.contact_id as string] : undefined,
      createdAt: opp.date_created as string,
      updatedAt: opp.date_updated as string,
    }
  }

  private mapCloseActivity(activity: Record<string, unknown>): Activity {
    const activityType = activity._type as string
    let type: Activity['type'] = 'note'
    if (activityType === 'Call') type = 'call'
    if (activityType === 'Email') type = 'email'
    if (activityType === 'Meeting') type = 'meeting'
    if (activityType === 'SMS') type = 'sms'

    return {
      id: activity.id as string,
      type,
      subject: (activity.subject ?? activity.title ?? activity.note ?? '') as string,
      body: (activity.body_text ?? activity.note ?? activity.text) as string | undefined,
      status: 'completed',
      duration: activity.duration as number | undefined,
      contactIds: activity.contact_id ? [activity.contact_id as string] : undefined,
      companyId: activity.lead_id as string,
      createdAt: activity.date_created as string,
      updatedAt: activity.date_updated as string,
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a unified CRM adapter from a provider-specific client
 *
 * @example
 * ```typescript
 * import { createCRMAdapter } from '@dotdo/crm'
 * import { PipedriveClient } from '@dotdo/pipedrive'
 * import { CloseClient } from '@dotdo/close'
 *
 * // Pipedrive
 * const pipedrive = new PipedriveClient({ storage })
 * const crmFromPipedrive = createCRMAdapter('pipedrive', pipedrive)
 *
 * // Close
 * const close = new CloseClient({ storage })
 * const crmFromClose = createCRMAdapter('close', close)
 *
 * // Both now have the same interface
 * const contact = await crmFromPipedrive.contacts.create({ email: 'a@b.com', firstName: 'A' })
 * const deal = await crmFromClose.deals.create({ name: 'Big Deal', amount: 50000, stage: 'Active' })
 * ```
 */
export function createCRMAdapter(provider: 'pipedrive', client: PipedriveClient): CRMAdapter
export function createCRMAdapter(provider: 'close', client: CloseClient): CRMAdapter
export function createCRMAdapter(provider: CRMProvider, client: unknown): CRMAdapter {
  switch (provider) {
    case 'pipedrive':
      return new PipedriveAdapter(client as PipedriveClient)
    case 'close':
      return new CloseAdapter(client as CloseClient)
    case 'salesforce':
      throw new Error('Salesforce adapter not yet implemented. Use @dotdo/salesforce directly.')
    case 'hubspot':
      throw new Error('HubSpot adapter not yet implemented. Use @dotdo/hubspot directly.')
    default:
      throw new Error(`Unknown CRM provider: ${provider}`)
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a provider supports a specific capability
 */
export function providerHasCapability(
  provider: CRMProvider,
  capability: keyof CRMCapabilities
): boolean {
  return PROVIDER_CAPABILITIES[provider][capability]
}

/**
 * Get all providers that support a specific capability
 */
export function getProvidersWithCapability(capability: keyof CRMCapabilities): CRMProvider[] {
  return (Object.keys(PROVIDER_CAPABILITIES) as CRMProvider[]).filter(
    (p) => PROVIDER_CAPABILITIES[p][capability]
  )
}
