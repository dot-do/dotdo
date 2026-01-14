/**
 * Salesforce Destination Adapter
 *
 * Implements a destination connector for syncing data to Salesforce.
 * Supports Contact, Lead, Account, and Opportunity objects with
 * field mapping, validation, and upsert with external ID.
 *
 * @module db/primitives/connector-framework/destinations/salesforce
 */

import type {
  DestinationConnectorDef,
  DestinationConnector,
  DestinationConfig,
  ConfiguredCatalog,
  AirbyteMessage,
  RecordMessage,
  DestinationConnectorSpec,
  ConnectionStatus,
  ConfigSpec,
} from '../index'
import { createDestinationConnector } from '../index'

// =============================================================================
// Types
// =============================================================================

/**
 * Salesforce destination configuration
 */
export interface SalesforceDestinationConfig extends DestinationConfig {
  /** Salesforce instance URL */
  instanceUrl: string
  /** OAuth access token */
  accessToken: string
  /** Optional refresh token */
  refreshToken?: string
  /** API version (default: 59.0) */
  apiVersion?: string
  /** Batch size for bulk operations (default: 200) */
  batchSize?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
}

/**
 * Supported Salesforce object types for syncing
 */
export type SalesforceObjectType = 'Contact' | 'Lead' | 'Account' | 'Opportunity'

/**
 * Field mapping from source to Salesforce field
 */
export interface SalesforceFieldMapping {
  source: string
  destination: string
  required?: boolean
  defaultValue?: unknown
  transform?: (value: unknown) => unknown
}

/**
 * Upsert options for Salesforce
 */
export interface SalesforceUpsertOptions {
  /** External ID field for upsert (e.g., 'External_Id__c') */
  externalIdField?: string
  /** Whether to use upsert (requires externalIdField) */
  useUpsert?: boolean
}

/**
 * Write result from Salesforce
 */
export interface SalesforceWriteResult {
  id?: string
  success: boolean
  created?: boolean
  errors: Array<{
    statusCode: string
    message: string
    fields?: string[]
  }>
}

// =============================================================================
// Field Mappings
// =============================================================================

/**
 * Default field mappings for Contact
 */
export const CONTACT_FIELD_MAPPINGS: SalesforceFieldMapping[] = [
  { source: 'email', destination: 'Email', required: true },
  { source: 'firstName', destination: 'FirstName' },
  { source: 'first_name', destination: 'FirstName' },
  { source: 'lastname', destination: 'LastName', required: true },
  { source: 'lastName', destination: 'LastName', required: true },
  { source: 'last_name', destination: 'LastName', required: true },
  { source: 'phone', destination: 'Phone' },
  { source: 'mobilePhone', destination: 'MobilePhone' },
  { source: 'mobile_phone', destination: 'MobilePhone' },
  { source: 'title', destination: 'Title' },
  { source: 'department', destination: 'Department' },
  { source: 'mailingStreet', destination: 'MailingStreet' },
  { source: 'mailing_street', destination: 'MailingStreet' },
  { source: 'mailingCity', destination: 'MailingCity' },
  { source: 'mailing_city', destination: 'MailingCity' },
  { source: 'mailingState', destination: 'MailingState' },
  { source: 'mailing_state', destination: 'MailingState' },
  { source: 'mailingPostalCode', destination: 'MailingPostalCode' },
  { source: 'mailing_postal_code', destination: 'MailingPostalCode' },
  { source: 'mailingCountry', destination: 'MailingCountry' },
  { source: 'mailing_country', destination: 'MailingCountry' },
  { source: 'description', destination: 'Description' },
  { source: 'accountId', destination: 'AccountId' },
  { source: 'account_id', destination: 'AccountId' },
]

/**
 * Default field mappings for Lead
 */
export const LEAD_FIELD_MAPPINGS: SalesforceFieldMapping[] = [
  { source: 'email', destination: 'Email' },
  { source: 'firstName', destination: 'FirstName' },
  { source: 'first_name', destination: 'FirstName' },
  { source: 'lastName', destination: 'LastName', required: true },
  { source: 'last_name', destination: 'LastName', required: true },
  { source: 'company', destination: 'Company', required: true },
  { source: 'phone', destination: 'Phone' },
  { source: 'mobilePhone', destination: 'MobilePhone' },
  { source: 'mobile_phone', destination: 'MobilePhone' },
  { source: 'title', destination: 'Title' },
  { source: 'industry', destination: 'Industry' },
  { source: 'street', destination: 'Street' },
  { source: 'city', destination: 'City' },
  { source: 'state', destination: 'State' },
  { source: 'postalCode', destination: 'PostalCode' },
  { source: 'postal_code', destination: 'PostalCode' },
  { source: 'country', destination: 'Country' },
  { source: 'status', destination: 'Status' },
  { source: 'leadSource', destination: 'LeadSource' },
  { source: 'lead_source', destination: 'LeadSource' },
  { source: 'rating', destination: 'Rating' },
  { source: 'description', destination: 'Description' },
  { source: 'website', destination: 'Website' },
  { source: 'numberOfEmployees', destination: 'NumberOfEmployees' },
  { source: 'number_of_employees', destination: 'NumberOfEmployees' },
  { source: 'annualRevenue', destination: 'AnnualRevenue' },
  { source: 'annual_revenue', destination: 'AnnualRevenue' },
]

/**
 * Default field mappings for Account
 */
export const ACCOUNT_FIELD_MAPPINGS: SalesforceFieldMapping[] = [
  { source: 'name', destination: 'Name', required: true },
  { source: 'type', destination: 'Type' },
  { source: 'industry', destination: 'Industry' },
  { source: 'phone', destination: 'Phone' },
  { source: 'fax', destination: 'Fax' },
  { source: 'website', destination: 'Website' },
  { source: 'billingStreet', destination: 'BillingStreet' },
  { source: 'billing_street', destination: 'BillingStreet' },
  { source: 'billingCity', destination: 'BillingCity' },
  { source: 'billing_city', destination: 'BillingCity' },
  { source: 'billingState', destination: 'BillingState' },
  { source: 'billing_state', destination: 'BillingState' },
  { source: 'billingPostalCode', destination: 'BillingPostalCode' },
  { source: 'billing_postal_code', destination: 'BillingPostalCode' },
  { source: 'billingCountry', destination: 'BillingCountry' },
  { source: 'billing_country', destination: 'BillingCountry' },
  { source: 'shippingStreet', destination: 'ShippingStreet' },
  { source: 'shipping_street', destination: 'ShippingStreet' },
  { source: 'shippingCity', destination: 'ShippingCity' },
  { source: 'shipping_city', destination: 'ShippingCity' },
  { source: 'shippingState', destination: 'ShippingState' },
  { source: 'shipping_state', destination: 'ShippingState' },
  { source: 'shippingPostalCode', destination: 'ShippingPostalCode' },
  { source: 'shipping_postal_code', destination: 'ShippingPostalCode' },
  { source: 'shippingCountry', destination: 'ShippingCountry' },
  { source: 'shipping_country', destination: 'ShippingCountry' },
  { source: 'description', destination: 'Description' },
  { source: 'numberOfEmployees', destination: 'NumberOfEmployees' },
  { source: 'number_of_employees', destination: 'NumberOfEmployees' },
  { source: 'annualRevenue', destination: 'AnnualRevenue' },
  { source: 'annual_revenue', destination: 'AnnualRevenue' },
  { source: 'ownership', destination: 'Ownership' },
  { source: 'tickerSymbol', destination: 'TickerSymbol' },
  { source: 'ticker_symbol', destination: 'TickerSymbol' },
  { source: 'rating', destination: 'Rating' },
  { source: 'site', destination: 'Site' },
  { source: 'parentId', destination: 'ParentId' },
  { source: 'parent_id', destination: 'ParentId' },
]

/**
 * Default field mappings for Opportunity
 */
export const OPPORTUNITY_FIELD_MAPPINGS: SalesforceFieldMapping[] = [
  { source: 'name', destination: 'Name', required: true },
  { source: 'accountId', destination: 'AccountId' },
  { source: 'account_id', destination: 'AccountId' },
  { source: 'amount', destination: 'Amount' },
  { source: 'closeDate', destination: 'CloseDate', required: true },
  { source: 'close_date', destination: 'CloseDate', required: true },
  { source: 'stageName', destination: 'StageName', required: true },
  { source: 'stage_name', destination: 'StageName', required: true },
  { source: 'stage', destination: 'StageName', required: true },
  { source: 'probability', destination: 'Probability' },
  { source: 'type', destination: 'Type' },
  { source: 'leadSource', destination: 'LeadSource' },
  { source: 'lead_source', destination: 'LeadSource' },
  { source: 'description', destination: 'Description' },
  { source: 'nextStep', destination: 'NextStep' },
  { source: 'next_step', destination: 'NextStep' },
  { source: 'forecastCategory', destination: 'ForecastCategory' },
  { source: 'forecast_category', destination: 'ForecastCategory' },
  { source: 'campaignId', destination: 'CampaignId' },
  { source: 'campaign_id', destination: 'CampaignId' },
]

/**
 * Get field mappings for an object type
 */
export function getFieldMappings(objectType: SalesforceObjectType): SalesforceFieldMapping[] {
  switch (objectType) {
    case 'Contact':
      return CONTACT_FIELD_MAPPINGS
    case 'Lead':
      return LEAD_FIELD_MAPPINGS
    case 'Account':
      return ACCOUNT_FIELD_MAPPINGS
    case 'Opportunity':
      return OPPORTUNITY_FIELD_MAPPINGS
    default:
      return []
  }
}

// =============================================================================
// Field Mapping and Validation
// =============================================================================

/**
 * Map a source record to Salesforce fields
 */
export function mapRecordToSalesforce(
  record: Record<string, unknown>,
  mappings: SalesforceFieldMapping[],
  customMappings?: SalesforceFieldMapping[]
): Record<string, unknown> {
  const allMappings = [...mappings, ...(customMappings || [])]
  const result: Record<string, unknown> = {}

  // Apply mappings
  for (const mapping of allMappings) {
    const value = record[mapping.source]
    if (value !== undefined && value !== null) {
      const transformedValue = mapping.transform ? mapping.transform(value) : value
      result[mapping.destination] = transformedValue
    } else if (mapping.defaultValue !== undefined) {
      result[mapping.destination] = mapping.defaultValue
    }
  }

  // Also copy any fields that match Salesforce field names directly
  for (const [key, value] of Object.entries(record)) {
    // Check if this is already mapped
    const isMapped = allMappings.some(m => m.source === key)
    if (!isMapped && value !== undefined && value !== null) {
      // Use as-is if it looks like a Salesforce field (PascalCase or ends with __c)
      if (/^[A-Z]/.test(key) || key.endsWith('__c')) {
        result[key] = value
      }
    }
  }

  return result
}

/**
 * Validate a record against required fields
 */
export function validateRecord(
  record: Record<string, unknown>,
  mappings: SalesforceFieldMapping[]
): { valid: boolean; missingFields: string[] } {
  const missingFields: string[] = []

  for (const mapping of mappings) {
    if (mapping.required) {
      const value = record[mapping.destination]
      if (value === undefined || value === null || value === '') {
        missingFields.push(mapping.destination)
      }
    }
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
  }
}

// =============================================================================
// Salesforce API Client
// =============================================================================

/**
 * Salesforce API Error
 */
export class SalesforceDestinationError extends Error {
  statusCode: number
  errorCode: string
  fields?: string[]

  constructor(message: string, statusCode: number, errorCode: string, fields?: string[]) {
    super(message)
    this.name = 'SalesforceDestinationError'
    this.statusCode = statusCode
    this.errorCode = errorCode
    this.fields = fields
  }
}

/**
 * Salesforce API client for destination operations
 */
export class SalesforceDestinationClient {
  private instanceUrl: string
  private accessToken: string
  private apiVersion: string
  private batchSize: number
  private _fetch: typeof fetch

  constructor(config: SalesforceDestinationConfig) {
    this.instanceUrl = config.instanceUrl.replace(/\/$/, '')
    this.accessToken = config.accessToken
    this.apiVersion = config.apiVersion || '59.0'
    this.batchSize = config.batchSize || 200
    this._fetch = config.fetch || globalThis.fetch.bind(globalThis)
  }

  /**
   * Check connection to Salesforce
   */
  async checkConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      const url = `${this.instanceUrl}/services/data/v${this.apiVersion}/limits`
      const response = await this._fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const error = await response.json()
        return {
          success: false,
          message: (error as { message?: string }).message || 'Authentication failed',
        }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed',
      }
    }
  }

  /**
   * Create a single record
   */
  async create(objectType: string, record: Record<string, unknown>): Promise<SalesforceWriteResult> {
    const url = `${this.instanceUrl}/services/data/v${this.apiVersion}/sobjects/${objectType}`
    const response = await this._fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(record),
    })

    const result = await response.json() as SalesforceWriteResult | Array<{ errorCode: string; message: string; fields?: string[] }>

    if (!response.ok) {
      const errors = Array.isArray(result) ? result : [result]
      return {
        success: false,
        errors: errors.map(e => ({
          statusCode: (e as { errorCode: string }).errorCode || 'UNKNOWN_ERROR',
          message: (e as { message: string }).message || 'Unknown error',
          fields: (e as { fields?: string[] }).fields,
        })),
      }
    }

    return {
      id: (result as SalesforceWriteResult).id,
      success: true,
      created: true,
      errors: [],
    }
  }

  /**
   * Update a single record
   */
  async update(objectType: string, id: string, record: Record<string, unknown>): Promise<SalesforceWriteResult> {
    const url = `${this.instanceUrl}/services/data/v${this.apiVersion}/sobjects/${objectType}/${id}`
    const response = await this._fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(record),
    })

    if (response.status === 204) {
      return { id, success: true, errors: [] }
    }

    const result = await response.json() as Array<{ errorCode: string; message: string; fields?: string[] }>

    return {
      success: false,
      errors: result.map(e => ({
        statusCode: e.errorCode || 'UNKNOWN_ERROR',
        message: e.message || 'Unknown error',
        fields: e.fields,
      })),
    }
  }

  /**
   * Upsert a single record using an external ID field
   */
  async upsert(
    objectType: string,
    externalIdField: string,
    externalIdValue: string,
    record: Record<string, unknown>
  ): Promise<SalesforceWriteResult> {
    const url = `${this.instanceUrl}/services/data/v${this.apiVersion}/sobjects/${objectType}/${externalIdField}/${encodeURIComponent(externalIdValue)}`
    const response = await this._fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(record),
    })

    // 201 = created, 204 = updated
    if (response.status === 201) {
      const result = await response.json() as { id: string }
      return { id: result.id, success: true, created: true, errors: [] }
    }

    if (response.status === 204) {
      return { success: true, created: false, errors: [] }
    }

    const result = await response.json() as Array<{ errorCode: string; message: string; fields?: string[] }>
    return {
      success: false,
      errors: result.map(e => ({
        statusCode: e.errorCode || 'UNKNOWN_ERROR',
        message: e.message || 'Unknown error',
        fields: e.fields,
      })),
    }
  }

  /**
   * Create multiple records in a batch
   */
  async createBatch(objectType: string, records: Record<string, unknown>[]): Promise<SalesforceWriteResult[]> {
    if (records.length === 0) return []

    const results: SalesforceWriteResult[] = []

    // Process in batches
    for (let i = 0; i < records.length; i += this.batchSize) {
      const batch = records.slice(i, i + this.batchSize)
      const url = `${this.instanceUrl}/services/data/v${this.apiVersion}/composite/sobjects`

      const response = await this._fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          allOrNone: false,
          records: batch.map(r => ({ attributes: { type: objectType }, ...r })),
        }),
      })

      const batchResults = await response.json() as SalesforceWriteResult[]
      results.push(...batchResults.map((r, idx) => ({
        id: r.id,
        success: r.success,
        created: r.success,
        errors: r.errors || [],
      })))
    }

    return results
  }

  /**
   * Upsert multiple records in a batch
   */
  async upsertBatch(
    objectType: string,
    externalIdField: string,
    records: Record<string, unknown>[]
  ): Promise<SalesforceWriteResult[]> {
    if (records.length === 0) return []

    const results: SalesforceWriteResult[] = []

    // Process in batches
    for (let i = 0; i < records.length; i += this.batchSize) {
      const batch = records.slice(i, i + this.batchSize)
      const url = `${this.instanceUrl}/services/data/v${this.apiVersion}/composite/sobjects/${objectType}/${externalIdField}`

      const response = await this._fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          allOrNone: false,
          records: batch.map(r => ({ attributes: { type: objectType }, ...r })),
        }),
      })

      const batchResults = await response.json() as SalesforceWriteResult[]
      results.push(...batchResults.map(r => ({
        id: r.id,
        success: r.success,
        created: r.created,
        errors: r.errors || [],
      })))
    }

    return results
  }
}

// =============================================================================
// Destination Connector Definition
// =============================================================================

/**
 * Configuration spec for Salesforce destination
 */
export const SALESFORCE_DESTINATION_CONFIG_SPEC: ConfigSpec = {
  type: 'object',
  required: ['instanceUrl', 'accessToken'],
  properties: {
    instanceUrl: {
      type: 'string',
      description: 'Salesforce instance URL (e.g., https://yourorg.my.salesforce.com)',
    },
    accessToken: {
      type: 'string',
      description: 'OAuth access token',
      secret: true,
    },
    refreshToken: {
      type: 'string',
      description: 'OAuth refresh token (optional)',
      secret: true,
    },
    apiVersion: {
      type: 'string',
      description: 'Salesforce API version (default: 59.0)',
      default: '59.0',
    },
    batchSize: {
      type: 'integer',
      description: 'Batch size for bulk operations (default: 200, max: 200)',
      default: 200,
      minimum: 1,
      maximum: 200,
    },
    externalIdField: {
      type: 'string',
      description: 'External ID field for upsert operations (e.g., External_Id__c)',
    },
    objectType: {
      type: 'string',
      description: 'Target Salesforce object type',
      enum: ['Contact', 'Lead', 'Account', 'Opportunity'],
    },
  },
}

/**
 * Salesforce destination connector definition
 */
export const salesforceDestinationDef: DestinationConnectorDef = {
  name: 'salesforce-destination',

  spec: async (): Promise<DestinationConnectorSpec> => ({
    name: 'Salesforce Destination',
    version: '1.0.0',
    configSpec: SALESFORCE_DESTINATION_CONFIG_SPEC,
    supportedSyncModes: ['overwrite', 'append', 'append_dedup'],
    documentationUrl: 'https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest',
    releaseStage: 'generally_available',
  }),

  check: async (config: DestinationConfig): Promise<ConnectionStatus> => {
    const sfConfig = config as SalesforceDestinationConfig
    const client = new SalesforceDestinationClient(sfConfig)
    const result = await client.checkConnection()

    return {
      status: result.success ? 'SUCCEEDED' : 'FAILED',
      message: result.message,
    }
  },

  write: async function* (
    config: DestinationConfig,
    catalog: ConfiguredCatalog,
    messages: AsyncIterable<AirbyteMessage>
  ): AsyncGenerator<AirbyteMessage, void, unknown> {
    const sfConfig = config as SalesforceDestinationConfig & { objectType?: SalesforceObjectType; externalIdField?: string }
    const client = new SalesforceDestinationClient(sfConfig)

    // Determine object type from config or stream name
    const getObjectTypeForStream = (streamName: string): SalesforceObjectType => {
      if (sfConfig.objectType) return sfConfig.objectType

      // Try to infer from stream name
      const normalized = streamName.toLowerCase()
      if (normalized.includes('contact')) return 'Contact'
      if (normalized.includes('lead')) return 'Lead'
      if (normalized.includes('account')) return 'Account'
      if (normalized.includes('opportunity') || normalized.includes('deal')) return 'Opportunity'

      // Default to Contact
      return 'Contact'
    }

    // Buffer for batch operations
    const recordBuffers: Map<string, Record<string, unknown>[]> = new Map()

    // Process messages
    for await (const message of messages) {
      if (message.type === 'RECORD') {
        const recordMessage = message as RecordMessage
        const streamName = recordMessage.record.stream
        const data = recordMessage.record.data

        // Get object type and mappings
        const objectType = getObjectTypeForStream(streamName)
        const mappings = getFieldMappings(objectType)

        // Map the record
        const mappedRecord = mapRecordToSalesforce(data, mappings)

        // Validate required fields
        const validation = validateRecord(mappedRecord, mappings)
        if (!validation.valid) {
          yield {
            type: 'LOG',
            log: {
              level: 'WARN',
              message: `Skipping record for ${objectType}: missing required fields ${validation.missingFields.join(', ')}`,
            },
          }
          continue
        }

        // Add to buffer
        if (!recordBuffers.has(streamName)) {
          recordBuffers.set(streamName, [])
        }
        recordBuffers.get(streamName)!.push(mappedRecord)

        // Flush buffer if it reaches batch size
        const buffer = recordBuffers.get(streamName)!
        if (buffer.length >= (sfConfig.batchSize || 200)) {
          const objectTypeForBuffer = getObjectTypeForStream(streamName)

          let results: SalesforceWriteResult[]
          if (sfConfig.externalIdField) {
            results = await client.upsertBatch(objectTypeForBuffer, sfConfig.externalIdField, buffer)
          } else {
            results = await client.createBatch(objectTypeForBuffer, buffer)
          }

          // Log results
          const successCount = results.filter(r => r.success).length
          const errorCount = results.length - successCount
          yield {
            type: 'LOG',
            log: {
              level: 'INFO',
              message: `Processed ${results.length} ${objectTypeForBuffer} records: ${successCount} succeeded, ${errorCount} failed`,
            },
          }

          // Clear buffer
          recordBuffers.set(streamName, [])
        }
      }

      if (message.type === 'STATE') {
        // Flush all buffers before emitting state
        for (const [streamName, buffer] of recordBuffers.entries()) {
          if (buffer.length > 0) {
            const objectType = getObjectTypeForStream(streamName)

            let results: SalesforceWriteResult[]
            if (sfConfig.externalIdField) {
              results = await client.upsertBatch(objectType, sfConfig.externalIdField, buffer)
            } else {
              results = await client.createBatch(objectType, buffer)
            }

            const successCount = results.filter(r => r.success).length
            yield {
              type: 'LOG',
              log: {
                level: 'INFO',
                message: `Flushed ${buffer.length} ${objectType} records: ${successCount} succeeded`,
              },
            }

            recordBuffers.set(streamName, [])
          }
        }

        // Forward state message
        yield message
      }
    }

    // Final flush of remaining records
    for (const [streamName, buffer] of recordBuffers.entries()) {
      if (buffer.length > 0) {
        const objectType = getObjectTypeForStream(streamName)

        let results: SalesforceWriteResult[]
        if (sfConfig.externalIdField) {
          results = await client.upsertBatch(objectType, sfConfig.externalIdField, buffer)
        } else {
          results = await client.createBatch(objectType, buffer)
        }

        const successCount = results.filter(r => r.success).length
        yield {
          type: 'LOG',
          log: {
            level: 'INFO',
            message: `Final flush: ${buffer.length} ${objectType} records: ${successCount} succeeded`,
          },
        }
      }
    }
  },
}

/**
 * Create a Salesforce destination connector
 */
export function createSalesforceDestination(): DestinationConnector {
  return createDestinationConnector(salesforceDestinationDef)
}

export default createSalesforceDestination
