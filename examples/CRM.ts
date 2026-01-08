/**
 * CRM - Multi-Tenant CRM Example
 *
 * Demonstrates the multi-tenant DO pattern:
 *
 *   crm.headless.ly              → CRM (App DO) - holds org registry, auth
 *   crm.headless.ly/acme         → CRMTenant (Tenant DO) - Acme's CRM data
 *   crm.headless.ly/acme/Contact/john → Thing within Acme's tenant
 *
 * Each tenant DO:
 *   - Has its own ns (e.g., 'https://crm.headless.ly/acme')
 *   - Stores all CRM data for that org (contacts, companies, deals)
 *   - Is located where the org is (locationHint)
 *   - Has full DO capabilities (things, relationships, actions, events)
 */

import { DO, type Env } from '../objects/DO'
import type { Thing } from '../types/Thing'

// ============================================================================
// CRM TYPES
// ============================================================================

export interface Org extends Thing {
  $type: 'Org'
  slug: string // 'acme'
  name: string // 'Acme Corp'
  plan: 'free' | 'pro' | 'enterprise'
  region: string // 'SFO', 'ORD', 'LHR'
  memberCount: number
}

export interface Member extends Thing {
  $type: 'Member'
  userId: string // Auth user ID
  orgId: string // Org slug
  role: 'owner' | 'admin' | 'member'
  email: string
}

export interface Contact extends Thing {
  $type: 'Contact'
  firstName: string
  lastName: string
  email: string
  phone?: string
  company?: string // Reference to Company
  status: 'lead' | 'prospect' | 'customer' | 'churned'
  source?: string
}

export interface Company extends Thing {
  $type: 'Company'
  name: string
  domain?: string
  industry?: string
  size?: 'startup' | 'smb' | 'mid-market' | 'enterprise'
  revenue?: number
}

export interface Deal extends Thing {
  $type: 'Deal'
  name: string
  value: number
  currency: string
  stage: 'discovery' | 'qualification' | 'proposal' | 'negotiation' | 'closed-won' | 'closed-lost'
  probability: number
  company?: string // Reference to Company
  contact?: string // Reference to Contact
  expectedCloseDate?: string
}

// ============================================================================
// CRM - App-Level DO (crm.headless.ly)
// ============================================================================

export class CRM extends DO {
  /**
   * Create a new tenant org
   *
   * 1. Creates Org thing in app DO
   * 2. Creates CRMTenant DO at crm.headless.ly/{slug}
   * 3. Sets locationHint based on region
   */
  async createOrg(data: { slug: string; name: string; plan?: Org['plan']; region?: string; ownerId: string }): Promise<Org> {
    const { slug, name, plan = 'free', region = 'SFO', ownerId } = data

    // Create Org thing in app DO
    const org = (await this.$.do('createOrg', {
      $type: 'Org',
      $id: slug,
      slug,
      name,
      plan,
      region,
      memberCount: 1,
    })) as Org

    // Create tenant DO with location hint
    const tenantNs = `${this.ns}/${slug}`
    const tenantDO = await this.createTenantDO(tenantNs, region)

    // Initialize tenant
    await tenantDO.initialize({ ns: tenantNs, parent: this.ns })

    // Create owner membership
    await this.$.do('createMember', {
      $type: 'Member',
      $id: `${slug}/${ownerId}`,
      userId: ownerId,
      orgId: slug,
      role: 'owner',
      email: '', // Will be filled from auth
    })

    return org
  }

  /**
   * Get tenant DO for an org
   */
  async getTenant(slug: string): Promise<CRMTenant> {
    const tenantNs = `${this.ns}/${slug}`
    // Look up in objects table, return DO stub
    return this.resolveTenantDO(tenantNs) as Promise<CRMTenant>
  }

  /**
   * List all orgs (for admin)
   */
  async listOrgs(): Promise<Org[]> {
    return this.collection<Org>('Org').list()
  }

  /**
   * Get orgs for a user
   */
  async getOrgsForUser(userId: string): Promise<Org[]> {
    const memberships = await this.collection<Member>('Member').find({ userId })

    const orgSlugs = memberships.map((m) => m.orgId)
    const orgs = await Promise.all(orgSlugs.map((slug) => this.collection<Org>('Org').get(slug)))

    return orgs.filter((o): o is Org => o !== null)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async createTenantDO(ns: string, region: string): Promise<CRMTenant> {
    // Map region to colo
    const locationHint = this.regionToColo(region)

    // Create DO with location hint
    const id = this.env.TENANT?.idFromName(ns)
    if (!id) throw new Error('TENANT binding not configured')

    // Store in objects table
    await this.db.insert(schema.objects).values({
      ns,
      id: id.toString(),
      class: 'CRMTenant',
      relation: 'child',
      region,
      primary: true,
      createdAt: new Date(),
    })

    // Get stub with location hint
    return this.env.TENANT.get(id, { locationHint }) as unknown as CRMTenant
  }

  private async resolveTenantDO(ns: string): Promise<CRMTenant> {
    // Look up in objects table
    const obj = await this.db.query.objects.findFirst({
      where: (t, { eq }) => eq(t.ns, ns),
    })

    if (!obj) throw new Error(`Tenant not found: ${ns}`)

    const id = this.env.TENANT?.idFromString(obj.id)
    if (!id) throw new Error('TENANT binding not configured')

    return this.env.TENANT.get(id) as unknown as CRMTenant
  }

  private regionToColo(region: string): string {
    const mapping: Record<string, string> = {
      'US-WEST': 'SFO',
      'US-EAST': 'IAD',
      'US-CENTRAL': 'ORD',
      'EU-WEST': 'LHR',
      'EU-CENTRAL': 'FRA',
      APAC: 'SIN',
      // Default to region as colo
    }
    return mapping[region] || region
  }
}

// ============================================================================
// CRM TENANT - Per-Org DO (crm.headless.ly/acme)
// ============================================================================

export class CRMTenant extends DO {
  // ═══════════════════════════════════════════════════════════════════════════
  // CONTACTS
  // ═══════════════════════════════════════════════════════════════════════════

  async createContact(data: Omit<Contact, '$type' | '$id'>): Promise<Contact> {
    const id = `${data.firstName.toLowerCase()}-${data.lastName.toLowerCase()}`
    return this.$.do('createContact', {
      ...data,
      $type: 'Contact',
      $id: id,
    }) as Promise<Contact>
  }

  async getContact(id: string): Promise<Contact | null> {
    return this.collection<Contact>('Contact').get(id)
  }

  async listContacts(filter?: { status?: Contact['status'] }): Promise<Contact[]> {
    if (filter?.status) {
      return this.collection<Contact>('Contact').find({ status: filter.status })
    }
    return this.collection<Contact>('Contact').list()
  }

  async updateContact(id: string, data: Partial<Contact>): Promise<Contact> {
    return this.$.do('updateContact', { $id: id, ...data }) as Promise<Contact>
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPANIES
  // ═══════════════════════════════════════════════════════════════════════════

  async createCompany(data: Omit<Company, '$type' | '$id'>): Promise<Company> {
    const id = data.name.toLowerCase().replace(/\s+/g, '-')
    return this.$.do('createCompany', {
      ...data,
      $type: 'Company',
      $id: id,
    }) as Promise<Company>
  }

  async getCompany(id: string): Promise<Company | null> {
    return this.collection<Company>('Company').get(id)
  }

  async listCompanies(): Promise<Company[]> {
    return this.collection<Company>('Company').list()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEALS
  // ═══════════════════════════════════════════════════════════════════════════

  async createDeal(data: Omit<Deal, '$type' | '$id'>): Promise<Deal> {
    const id = crypto.randomUUID().slice(0, 8)
    return this.$.do('createDeal', {
      ...data,
      $type: 'Deal',
      $id: id,
    }) as Promise<Deal>
  }

  async getDeal(id: string): Promise<Deal | null> {
    return this.collection<Deal>('Deal').get(id)
  }

  async listDeals(filter?: { stage?: Deal['stage'] }): Promise<Deal[]> {
    if (filter?.stage) {
      return this.collection<Deal>('Deal').find({ stage: filter.stage })
    }
    return this.collection<Deal>('Deal').list()
  }

  async updateDeal(id: string, data: Partial<Deal>): Promise<Deal> {
    return this.$.do('updateDeal', { $id: id, ...data }) as Promise<Deal>
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PIPELINE / ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════

  async getPipelineValue(): Promise<{ stage: string; value: number; count: number }[]> {
    const deals = await this.listDeals()
    const byStage = new Map<string, { value: number; count: number }>()

    for (const deal of deals) {
      const current = byStage.get(deal.stage) || { value: 0, count: 0 }
      byStage.set(deal.stage, {
        value: current.value + deal.value,
        count: current.count + 1,
      })
    }

    return Array.from(byStage.entries()).map(([stage, data]) => ({
      stage,
      ...data,
    }))
  }

  async getForecast(): Promise<number> {
    const deals = await this.listDeals()
    return deals.reduce((sum, deal) => {
      if (deal.stage === 'closed-won') return sum + deal.value
      if (deal.stage === 'closed-lost') return sum
      return sum + deal.value * deal.probability
    }, 0)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RELATIONSHIPS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Link a contact to a company
   */
  async linkContactToCompany(contactId: string, companyId: string): Promise<void> {
    await this.relationships.create({
      verb: 'worksAt',
      from: `${this.ns}/Contact/${contactId}`,
      to: `${this.ns}/Company/${companyId}`,
    })

    // Also update contact's company field
    await this.updateContact(contactId, { company: companyId })
  }

  /**
   * Get contacts at a company
   */
  async getContactsAtCompany(companyId: string): Promise<Contact[]> {
    const rels = await this.relationships.list({
      to: `${this.ns}/Company/${companyId}`,
      verb: 'worksAt',
    })

    const contactIds = rels.map((r) => r.from.split('/').pop()!)
    const contacts = await Promise.all(contactIds.map((id) => this.getContact(id)))

    return contacts.filter((c): c is Contact => c !== null)
  }
}

// ============================================================================
// WRANGLER CONFIG
// ============================================================================

/*
# wrangler.toml

[[durable_objects.bindings]]
name = "CRM"
class_name = "CRM"

[[durable_objects.bindings]]
name = "TENANT"
class_name = "CRMTenant"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["CRM", "CRMTenant"]
*/

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

/*
// In Worker

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Auth middleware (better-auth)
    const session = await auth.getSession(request)
    if (!session) return new Response('Unauthorized', { status: 401 })

    // Route: /api/orgs - list user's orgs
    if (url.pathname === '/api/orgs') {
      const crm = env.CRM.get(env.CRM.idFromName('crm.headless.ly'))
      const orgs = await crm.getOrgsForUser(session.userId)
      return Response.json(orgs)
    }

    // Route: /api/orgs/:slug/* - tenant-specific endpoints
    const match = url.pathname.match(/^\/api\/orgs\/([^/]+)\/(.*)/)
    if (match) {
      const [, slug, path] = match

      // Verify user has access to this org
      const crm = env.CRM.get(env.CRM.idFromName('crm.headless.ly'))
      const orgs = await crm.getOrgsForUser(session.userId)
      if (!orgs.some(o => o.slug === slug)) {
        return new Response('Forbidden', { status: 403 })
      }

      // Get tenant DO
      const tenant = await crm.getTenant(slug)

      // Route to tenant methods
      if (path === 'contacts') {
        const contacts = await tenant.listContacts()
        return Response.json(contacts)
      }

      if (path === 'pipeline') {
        const pipeline = await tenant.getPipelineValue()
        return Response.json(pipeline)
      }

      // ... more routes
    }

    return new Response('Not Found', { status: 404 })
  }
}
*/

// Need to import schema for DB operations
import * as schema from '../db'
