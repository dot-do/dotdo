/**
 * @dotdo/lib/tools/adapters/hubspot.ts - HubSpot Provider Adapter
 *
 * Exposes HubSpot compat SDK as Tool Things.
 *
 * @example
 * ```typescript
 * import { hubspotAdapter } from 'lib/tools/adapters/hubspot'
 * import { globalRegistry } from 'lib/tools'
 *
 * globalRegistry.register(hubspotAdapter)
 *
 * await globalRegistry.execute(
 *   'hubspot',
 *   'create_contact',
 *   {
 *     email: 'contact@example.com',
 *     firstname: 'Jane',
 *     lastname: 'Doe',
 *   },
 *   { apiKey: 'xxx' }
 * )
 * ```
 */

import {
  createProviderAdapter,
  type ProviderToolAdapter,
  type RuntimeCredentials,
  type ToolContext,
  ProviderError,
} from '../provider-adapter'

// =============================================================================
// Types
// =============================================================================

interface CreateContactParams {
  email: string
  firstname?: string
  lastname?: string
  phone?: string
  company?: string
  website?: string
  jobtitle?: string
  city?: string
  state?: string
  country?: string
  properties?: Record<string, string>
}

interface CreateCompanyParams {
  name: string
  domain?: string
  industry?: string
  phone?: string
  city?: string
  state?: string
  country?: string
  website?: string
  description?: string
  properties?: Record<string, string>
}

interface CreateDealParams {
  dealname: string
  amount?: number
  dealstage?: string
  pipeline?: string
  closedate?: string
  hubspot_owner_id?: string
  properties?: Record<string, string>
}

interface SearchParams {
  filterGroups?: Array<{
    filters: Array<{
      propertyName: string
      operator: string
      value: string | number
    }>
  }>
  sorts?: Array<{
    propertyName: string
    direction: 'ASCENDING' | 'DESCENDING'
  }>
  limit?: number
  after?: string
  properties?: string[]
}

// =============================================================================
// Handlers
// =============================================================================

async function createContact(
  params: CreateContactParams,
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  if (!credentials.apiKey) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'HubSpot API key is required',
      provider: 'hubspot',
      toolId: 'create_contact',
    })
  }

  const { Client } = await import('../../../compat/hubspot')

  const client = new Client({ accessToken: credentials.apiKey })

  try {
    // Build properties object
    const properties: Record<string, string> = {
      email: params.email,
    }

    if (params.firstname) properties.firstname = params.firstname
    if (params.lastname) properties.lastname = params.lastname
    if (params.phone) properties.phone = params.phone
    if (params.company) properties.company = params.company
    if (params.website) properties.website = params.website
    if (params.jobtitle) properties.jobtitle = params.jobtitle
    if (params.city) properties.city = params.city
    if (params.state) properties.state = params.state
    if (params.country) properties.country = params.country
    if (params.properties) Object.assign(properties, params.properties)

    return await client.crm.contacts.basicApi.create({
      properties,
    })
  } catch (error) {
    throw new ProviderError({
      code: 'CREATE_CONTACT_FAILED',
      message: error instanceof Error ? error.message : 'Failed to create contact',
      provider: 'hubspot',
      toolId: 'create_contact',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function createCompany(
  params: CreateCompanyParams,
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  if (!credentials.apiKey) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'HubSpot API key is required',
      provider: 'hubspot',
      toolId: 'create_company',
    })
  }

  const { Client } = await import('../../../compat/hubspot')

  const client = new Client({ accessToken: credentials.apiKey })

  try {
    const properties: Record<string, string> = {
      name: params.name,
    }

    if (params.domain) properties.domain = params.domain
    if (params.industry) properties.industry = params.industry
    if (params.phone) properties.phone = params.phone
    if (params.city) properties.city = params.city
    if (params.state) properties.state = params.state
    if (params.country) properties.country = params.country
    if (params.website) properties.website = params.website
    if (params.description) properties.description = params.description
    if (params.properties) Object.assign(properties, params.properties)

    return await client.crm.companies.basicApi.create({
      properties,
    })
  } catch (error) {
    throw new ProviderError({
      code: 'CREATE_COMPANY_FAILED',
      message: error instanceof Error ? error.message : 'Failed to create company',
      provider: 'hubspot',
      toolId: 'create_company',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function createDeal(
  params: CreateDealParams,
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  if (!credentials.apiKey) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'HubSpot API key is required',
      provider: 'hubspot',
      toolId: 'create_deal',
    })
  }

  const { Client } = await import('../../../compat/hubspot')

  const client = new Client({ accessToken: credentials.apiKey })

  try {
    const properties: Record<string, string> = {
      dealname: params.dealname,
    }

    if (params.amount !== undefined) properties.amount = String(params.amount)
    if (params.dealstage) properties.dealstage = params.dealstage
    if (params.pipeline) properties.pipeline = params.pipeline
    if (params.closedate) properties.closedate = params.closedate
    if (params.hubspot_owner_id) properties.hubspot_owner_id = params.hubspot_owner_id
    if (params.properties) Object.assign(properties, params.properties)

    return await client.crm.deals.basicApi.create({
      properties,
    })
  } catch (error) {
    throw new ProviderError({
      code: 'CREATE_DEAL_FAILED',
      message: error instanceof Error ? error.message : 'Failed to create deal',
      provider: 'hubspot',
      toolId: 'create_deal',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function searchContacts(
  params: SearchParams,
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  if (!credentials.apiKey) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'HubSpot API key is required',
      provider: 'hubspot',
      toolId: 'search_contacts',
    })
  }

  const { Client } = await import('../../../compat/hubspot')

  const client = new Client({ accessToken: credentials.apiKey })

  try {
    return await client.crm.contacts.searchApi.doSearch({
      filterGroups: params.filterGroups || [],
      sorts: params.sorts,
      limit: params.limit || 10,
      after: params.after,
      properties: params.properties || ['email', 'firstname', 'lastname', 'phone'],
    })
  } catch (error) {
    throw new ProviderError({
      code: 'SEARCH_CONTACTS_FAILED',
      message: error instanceof Error ? error.message : 'Failed to search contacts',
      provider: 'hubspot',
      toolId: 'search_contacts',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function searchCompanies(
  params: SearchParams,
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  if (!credentials.apiKey) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'HubSpot API key is required',
      provider: 'hubspot',
      toolId: 'search_companies',
    })
  }

  const { Client } = await import('../../../compat/hubspot')

  const client = new Client({ accessToken: credentials.apiKey })

  try {
    return await client.crm.companies.searchApi.doSearch({
      filterGroups: params.filterGroups || [],
      sorts: params.sorts,
      limit: params.limit || 10,
      after: params.after,
      properties: params.properties || ['name', 'domain', 'industry', 'phone'],
    })
  } catch (error) {
    throw new ProviderError({
      code: 'SEARCH_COMPANIES_FAILED',
      message: error instanceof Error ? error.message : 'Failed to search companies',
      provider: 'hubspot',
      toolId: 'search_companies',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function searchDeals(
  params: SearchParams,
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  if (!credentials.apiKey) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'HubSpot API key is required',
      provider: 'hubspot',
      toolId: 'search_deals',
    })
  }

  const { Client } = await import('../../../compat/hubspot')

  const client = new Client({ accessToken: credentials.apiKey })

  try {
    return await client.crm.deals.searchApi.doSearch({
      filterGroups: params.filterGroups || [],
      sorts: params.sorts,
      limit: params.limit || 10,
      after: params.after,
      properties: params.properties || ['dealname', 'amount', 'dealstage', 'closedate'],
    })
  } catch (error) {
    throw new ProviderError({
      code: 'SEARCH_DEALS_FAILED',
      message: error instanceof Error ? error.message : 'Failed to search deals',
      provider: 'hubspot',
      toolId: 'search_deals',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

// =============================================================================
// Adapter Definition
// =============================================================================

/**
 * HubSpot provider adapter
 */
export const hubspotAdapter: ProviderToolAdapter = createProviderAdapter({
  name: 'hubspot',
  displayName: 'HubSpot',
  description: 'CRM platform for marketing, sales, and customer service',
  category: 'crm',
  credential: {
    type: 'bearer_token',
    headerName: 'Authorization',
    headerPrefix: 'Bearer',
    envVar: 'HUBSPOT_ACCESS_TOKEN',
    required: true,
  },
  baseUrl: 'https://api.hubapi.com',
  timeout: 30000,
  maxRetries: 2,
  iconUrl: 'https://hubspot.com/favicon.ico',
  docsUrl: 'https://developers.hubspot.com/docs/api',
  version: '1.0.0',
  tools: [
    {
      id: 'create_contact',
      name: 'Create Contact',
      description: 'Create a new contact in HubSpot CRM',
      parameters: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            description: 'Contact email address (required)',
          },
          firstname: {
            type: 'string',
            description: 'Contact first name',
          },
          lastname: {
            type: 'string',
            description: 'Contact last name',
          },
          phone: {
            type: 'string',
            description: 'Contact phone number',
          },
          company: {
            type: 'string',
            description: 'Company name',
          },
          website: {
            type: 'string',
            description: 'Contact website URL',
          },
          jobtitle: {
            type: 'string',
            description: 'Job title',
          },
          city: {
            type: 'string',
            description: 'City',
          },
          state: {
            type: 'string',
            description: 'State/Region',
          },
          country: {
            type: 'string',
            description: 'Country',
          },
          properties: {
            type: 'object',
            description: 'Additional custom properties',
          },
        },
        required: ['email'],
      },
      handler: createContact,
      tags: ['contact', 'crm', 'lead'],
      rateLimitTier: 'high',
      examples: [
        {
          name: 'Basic Contact',
          description: 'Create a simple contact',
          input: {
            email: 'jane.doe@example.com',
            firstname: 'Jane',
            lastname: 'Doe',
          },
        },
        {
          name: 'Full Contact',
          description: 'Create a contact with all details',
          input: {
            email: 'john.smith@company.com',
            firstname: 'John',
            lastname: 'Smith',
            company: 'Acme Inc',
            jobtitle: 'VP of Sales',
            phone: '+1-555-0100',
          },
        },
      ],
    },
    {
      id: 'create_company',
      name: 'Create Company',
      description: 'Create a new company in HubSpot CRM',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Company name (required)',
          },
          domain: {
            type: 'string',
            description: 'Company domain (e.g., example.com)',
          },
          industry: {
            type: 'string',
            description: 'Industry type',
          },
          phone: {
            type: 'string',
            description: 'Company phone number',
          },
          city: {
            type: 'string',
            description: 'City',
          },
          state: {
            type: 'string',
            description: 'State/Region',
          },
          country: {
            type: 'string',
            description: 'Country',
          },
          website: {
            type: 'string',
            description: 'Company website URL',
          },
          description: {
            type: 'string',
            description: 'Company description',
          },
          properties: {
            type: 'object',
            description: 'Additional custom properties',
          },
        },
        required: ['name'],
      },
      handler: createCompany,
      tags: ['company', 'crm', 'account'],
      rateLimitTier: 'high',
      examples: [
        {
          name: 'Simple Company',
          description: 'Create a company with basic info',
          input: {
            name: 'Acme Inc',
            domain: 'acme.com',
          },
        },
      ],
    },
    {
      id: 'create_deal',
      name: 'Create Deal',
      description: 'Create a new deal in HubSpot CRM',
      parameters: {
        type: 'object',
        properties: {
          dealname: {
            type: 'string',
            description: 'Deal name (required)',
          },
          amount: {
            type: 'number',
            description: 'Deal amount',
          },
          dealstage: {
            type: 'string',
            description: 'Deal stage ID',
          },
          pipeline: {
            type: 'string',
            description: 'Pipeline ID',
          },
          closedate: {
            type: 'string',
            description: 'Expected close date (ISO 8601)',
          },
          hubspot_owner_id: {
            type: 'string',
            description: 'HubSpot owner ID',
          },
          properties: {
            type: 'object',
            description: 'Additional custom properties',
          },
        },
        required: ['dealname'],
      },
      handler: createDeal,
      tags: ['deal', 'crm', 'sales', 'opportunity'],
      rateLimitTier: 'high',
      examples: [
        {
          name: 'Basic Deal',
          description: 'Create a simple deal',
          input: {
            dealname: 'Enterprise License - Acme Inc',
            amount: 50000,
          },
        },
      ],
    },
    {
      id: 'search_contacts',
      name: 'Search Contacts',
      description: 'Search contacts in HubSpot CRM using filters',
      parameters: {
        type: 'object',
        properties: {
          filterGroups: {
            type: 'array',
            description: 'Filter groups for the search query',
            items: { type: 'object' },
          },
          sorts: {
            type: 'array',
            description: 'Sort order for results',
            items: { type: 'object' },
          },
          limit: {
            type: 'number',
            description: 'Number of results to return (max 100)',
            default: 10,
          },
          after: {
            type: 'string',
            description: 'Pagination cursor',
          },
          properties: {
            type: 'array',
            description: 'Properties to include in response',
            items: { type: 'string' },
          },
        },
      },
      handler: searchContacts,
      tags: ['contact', 'crm', 'search'],
      rateLimitTier: 'medium',
    },
    {
      id: 'search_companies',
      name: 'Search Companies',
      description: 'Search companies in HubSpot CRM using filters',
      parameters: {
        type: 'object',
        properties: {
          filterGroups: {
            type: 'array',
            description: 'Filter groups for the search query',
            items: { type: 'object' },
          },
          sorts: {
            type: 'array',
            description: 'Sort order for results',
            items: { type: 'object' },
          },
          limit: {
            type: 'number',
            description: 'Number of results to return (max 100)',
            default: 10,
          },
          after: {
            type: 'string',
            description: 'Pagination cursor',
          },
          properties: {
            type: 'array',
            description: 'Properties to include in response',
            items: { type: 'string' },
          },
        },
      },
      handler: searchCompanies,
      tags: ['company', 'crm', 'search'],
      rateLimitTier: 'medium',
    },
    {
      id: 'search_deals',
      name: 'Search Deals',
      description: 'Search deals in HubSpot CRM using filters',
      parameters: {
        type: 'object',
        properties: {
          filterGroups: {
            type: 'array',
            description: 'Filter groups for the search query',
            items: { type: 'object' },
          },
          sorts: {
            type: 'array',
            description: 'Sort order for results',
            items: { type: 'object' },
          },
          limit: {
            type: 'number',
            description: 'Number of results to return (max 100)',
            default: 10,
          },
          after: {
            type: 'string',
            description: 'Pagination cursor',
          },
          properties: {
            type: 'array',
            description: 'Properties to include in response',
            items: { type: 'string' },
          },
        },
      },
      handler: searchDeals,
      tags: ['deal', 'crm', 'search'],
      rateLimitTier: 'medium',
    },
  ],
})

export default hubspotAdapter
