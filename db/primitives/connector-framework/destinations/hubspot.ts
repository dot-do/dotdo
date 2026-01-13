/**
 * HubSpot Destination Adapter
 *
 * Implements a destination connector for syncing data to HubSpot.
 * Supports Contact, Company, and Deal objects with
 * property mapping, validation, and batch operations.
 *
 * @module db/primitives/connector-framework/destinations/hubspot
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
 * HubSpot destination configuration
 */
export interface HubSpotDestinationConfig extends DestinationConfig {
  /** HubSpot API access token (private app or OAuth) */
  accessToken: string
  /** Base API URL (default: https://api.hubapi.com) */
  basePath?: string
  /** Batch size for operations (default: 100, max: 100) */
  batchSize?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
}

/**
 * Supported HubSpot object types for syncing
 */
export type HubSpotObjectType = 'contacts' | 'companies' | 'deals'

/**
 * Property mapping from source to HubSpot property
 */
export interface HubSpotPropertyMapping {
  source: string
  destination: string
  required?: boolean
  defaultValue?: string
  transform?: (value: unknown) => string
}

/**
 * HubSpot API result for single operations
 */
export interface HubSpotWriteResult {
  id?: string
  success: boolean
  error?: {
    status: string
    category: string
    message: string
    correlationId?: string
  }
}

/**
 * HubSpot batch result
 */
export interface HubSpotBatchResult {
  status: 'COMPLETE' | 'PENDING' | 'PROCESSING' | 'CANCELED'
  results: Array<{
    id: string
    properties: Record<string, string | null>
    createdAt: string
    updatedAt: string
    archived: boolean
  }>
  errors: Array<{
    status: string
    category: string
    message: string
    correlationId: string
    context?: Record<string, string[]>
  }>
}

// =============================================================================
// Property Mappings
// =============================================================================

/**
 * Default property mappings for Contact
 */
export const CONTACT_PROPERTY_MAPPINGS: HubSpotPropertyMapping[] = [
  { source: 'email', destination: 'email', required: true },
  { source: 'firstName', destination: 'firstname' },
  { source: 'first_name', destination: 'firstname' },
  { source: 'firstname', destination: 'firstname' },
  { source: 'lastName', destination: 'lastname' },
  { source: 'last_name', destination: 'lastname' },
  { source: 'lastname', destination: 'lastname' },
  { source: 'phone', destination: 'phone' },
  { source: 'mobilePhone', destination: 'mobilephone' },
  { source: 'mobile_phone', destination: 'mobilephone' },
  { source: 'company', destination: 'company' },
  { source: 'website', destination: 'website' },
  { source: 'address', destination: 'address' },
  { source: 'city', destination: 'city' },
  { source: 'state', destination: 'state' },
  { source: 'zip', destination: 'zip' },
  { source: 'zipCode', destination: 'zip' },
  { source: 'zip_code', destination: 'zip' },
  { source: 'country', destination: 'country' },
  { source: 'jobTitle', destination: 'jobtitle' },
  { source: 'job_title', destination: 'jobtitle' },
  { source: 'title', destination: 'jobtitle' },
  { source: 'lifecycleStage', destination: 'lifecyclestage' },
  { source: 'lifecycle_stage', destination: 'lifecyclestage' },
  { source: 'leadStatus', destination: 'hs_lead_status' },
  { source: 'lead_status', destination: 'hs_lead_status' },
  { source: 'industry', destination: 'industry' },
  { source: 'message', destination: 'message' },
  { source: 'numEmployees', destination: 'numemployees' },
  { source: 'num_employees', destination: 'numemployees' },
  { source: 'annualRevenue', destination: 'annualrevenue' },
  { source: 'annual_revenue', destination: 'annualrevenue' },
]

/**
 * Default property mappings for Company
 */
export const COMPANY_PROPERTY_MAPPINGS: HubSpotPropertyMapping[] = [
  { source: 'name', destination: 'name', required: true },
  { source: 'domain', destination: 'domain' },
  { source: 'industry', destination: 'industry' },
  { source: 'description', destination: 'description' },
  { source: 'phone', destination: 'phone' },
  { source: 'address', destination: 'address' },
  { source: 'city', destination: 'city' },
  { source: 'state', destination: 'state' },
  { source: 'zip', destination: 'zip' },
  { source: 'zipCode', destination: 'zip' },
  { source: 'zip_code', destination: 'zip' },
  { source: 'country', destination: 'country' },
  { source: 'website', destination: 'website' },
  { source: 'numberOfEmployees', destination: 'numberofemployees' },
  { source: 'number_of_employees', destination: 'numberofemployees' },
  { source: 'numEmployees', destination: 'numberofemployees' },
  { source: 'annualRevenue', destination: 'annualrevenue' },
  { source: 'annual_revenue', destination: 'annualrevenue' },
  { source: 'type', destination: 'type' },
  { source: 'linkedinUrl', destination: 'linkedin_company_page' },
  { source: 'linkedin_url', destination: 'linkedin_company_page' },
  { source: 'twitterHandle', destination: 'twitterhandle' },
  { source: 'twitter_handle', destination: 'twitterhandle' },
  { source: 'facebookUrl', destination: 'facebook_company_page' },
  { source: 'facebook_url', destination: 'facebook_company_page' },
]

/**
 * Default property mappings for Deal
 */
export const DEAL_PROPERTY_MAPPINGS: HubSpotPropertyMapping[] = [
  { source: 'dealname', destination: 'dealname', required: true },
  { source: 'name', destination: 'dealname', required: true },
  { source: 'deal_name', destination: 'dealname', required: true },
  { source: 'amount', destination: 'amount' },
  { source: 'value', destination: 'amount' },
  { source: 'dealstage', destination: 'dealstage' },
  { source: 'deal_stage', destination: 'dealstage' },
  { source: 'stage', destination: 'dealstage' },
  { source: 'pipeline', destination: 'pipeline' },
  { source: 'closedate', destination: 'closedate' },
  { source: 'close_date', destination: 'closedate' },
  { source: 'description', destination: 'description' },
  { source: 'dealtype', destination: 'dealtype' },
  { source: 'deal_type', destination: 'dealtype' },
  { source: 'type', destination: 'dealtype' },
  { source: 'ownerId', destination: 'hubspot_owner_id' },
  { source: 'owner_id', destination: 'hubspot_owner_id' },
  { source: 'hubspotOwnerId', destination: 'hubspot_owner_id' },
  { source: 'priority', destination: 'hs_priority' },
  { source: 'forecastCategory', destination: 'hs_forecast_category' },
  { source: 'forecast_category', destination: 'hs_forecast_category' },
  { source: 'forecastProbability', destination: 'hs_forecast_probability' },
  { source: 'forecast_probability', destination: 'hs_forecast_probability' },
]

/**
 * Get property mappings for an object type
 */
export function getPropertyMappings(objectType: HubSpotObjectType): HubSpotPropertyMapping[] {
  switch (objectType) {
    case 'contacts':
      return CONTACT_PROPERTY_MAPPINGS
    case 'companies':
      return COMPANY_PROPERTY_MAPPINGS
    case 'deals':
      return DEAL_PROPERTY_MAPPINGS
    default:
      return []
  }
}

// =============================================================================
// Property Mapping and Validation
// =============================================================================

/**
 * Map a source record to HubSpot properties
 */
export function mapRecordToHubSpot(
  record: Record<string, unknown>,
  mappings: HubSpotPropertyMapping[],
  customMappings?: HubSpotPropertyMapping[]
): Record<string, string> {
  const allMappings = [...mappings, ...(customMappings || [])]
  const result: Record<string, string> = {}

  // Apply mappings
  for (const mapping of allMappings) {
    const value = record[mapping.source]
    if (value !== undefined && value !== null) {
      let stringValue: string
      if (mapping.transform) {
        stringValue = mapping.transform(value)
      } else if (value instanceof Date) {
        // HubSpot expects dates as milliseconds since epoch
        stringValue = value.getTime().toString()
      } else if (typeof value === 'object') {
        stringValue = JSON.stringify(value)
      } else {
        stringValue = String(value)
      }
      result[mapping.destination] = stringValue
    } else if (mapping.defaultValue !== undefined) {
      result[mapping.destination] = mapping.defaultValue
    }
  }

  // Also copy any fields that are already HubSpot property names (lowercase, no special chars)
  for (const [key, value] of Object.entries(record)) {
    // Check if this is already mapped
    const isMapped = allMappings.some(m => m.source === key)
    if (!isMapped && value !== undefined && value !== null) {
      // Use as-is if it looks like a HubSpot property name (lowercase alphanumeric with underscores)
      if (/^[a-z][a-z0-9_]*$/.test(key)) {
        result[key] = typeof value === 'object' ? JSON.stringify(value) : String(value)
      }
    }
  }

  return result
}

/**
 * Validate a record against required properties
 */
export function validateRecord(
  record: Record<string, string>,
  mappings: HubSpotPropertyMapping[]
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
// HubSpot API Client
// =============================================================================

/**
 * HubSpot API Error
 */
export class HubSpotDestinationError extends Error {
  status: string
  category: string
  correlationId?: string

  constructor(message: string, status: string, category: string, correlationId?: string) {
    super(message)
    this.name = 'HubSpotDestinationError'
    this.status = status
    this.category = category
    this.correlationId = correlationId
  }
}

/**
 * HubSpot API client for destination operations
 */
export class HubSpotDestinationClient {
  private accessToken: string
  private basePath: string
  private batchSize: number
  private _fetch: typeof fetch

  constructor(config: HubSpotDestinationConfig) {
    this.accessToken = config.accessToken
    this.basePath = (config.basePath || 'https://api.hubapi.com').replace(/\/$/, '')
    this.batchSize = Math.min(config.batchSize || 100, 100)
    this._fetch = config.fetch || globalThis.fetch.bind(globalThis)
  }

  /**
   * Check connection to HubSpot
   */
  async checkConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      const url = `${this.basePath}/crm/v3/objects/contacts?limit=1`
      const response = await this._fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          success: false,
          message: error.message || 'Authentication failed',
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
  async create(objectType: HubSpotObjectType, properties: Record<string, string>): Promise<HubSpotWriteResult> {
    const url = `${this.basePath}/crm/v3/objects/${objectType}`
    const response = await this._fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    })

    if (!response.ok) {
      const error = await response.json() as { status: string; category: string; message: string; correlationId?: string }
      return {
        success: false,
        error: {
          status: error.status || 'error',
          category: error.category || 'UNKNOWN',
          message: error.message || 'Unknown error',
          correlationId: error.correlationId,
        },
      }
    }

    const result = await response.json() as { id: string }
    return { id: result.id, success: true }
  }

  /**
   * Update a single record
   */
  async update(objectType: HubSpotObjectType, id: string, properties: Record<string, string>): Promise<HubSpotWriteResult> {
    const url = `${this.basePath}/crm/v3/objects/${objectType}/${id}`
    const response = await this._fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    })

    if (!response.ok) {
      const error = await response.json() as { status: string; category: string; message: string; correlationId?: string }
      return {
        success: false,
        error: {
          status: error.status || 'error',
          category: error.category || 'UNKNOWN',
          message: error.message || 'Unknown error',
          correlationId: error.correlationId,
        },
      }
    }

    const result = await response.json() as { id: string }
    return { id: result.id, success: true }
  }

  /**
   * Create multiple records in a batch
   */
  async createBatch(objectType: HubSpotObjectType, records: Array<{ properties: Record<string, string> }>): Promise<HubSpotBatchResult> {
    if (records.length === 0) {
      return { status: 'COMPLETE', results: [], errors: [] }
    }

    const allResults: HubSpotBatchResult['results'] = []
    const allErrors: HubSpotBatchResult['errors'] = []

    // Process in batches
    for (let i = 0; i < records.length; i += this.batchSize) {
      const batch = records.slice(i, i + this.batchSize)
      const url = `${this.basePath}/crm/v3/objects/${objectType}/batch/create`

      const response = await this._fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: batch }),
      })

      const result = await response.json() as HubSpotBatchResult

      if (result.results) {
        allResults.push(...result.results)
      }
      if (result.errors) {
        allErrors.push(...result.errors)
      }
    }

    return {
      status: 'COMPLETE',
      results: allResults,
      errors: allErrors,
    }
  }

  /**
   * Update multiple records in a batch
   */
  async updateBatch(objectType: HubSpotObjectType, records: Array<{ id: string; properties: Record<string, string> }>): Promise<HubSpotBatchResult> {
    if (records.length === 0) {
      return { status: 'COMPLETE', results: [], errors: [] }
    }

    const allResults: HubSpotBatchResult['results'] = []
    const allErrors: HubSpotBatchResult['errors'] = []

    // Process in batches
    for (let i = 0; i < records.length; i += this.batchSize) {
      const batch = records.slice(i, i + this.batchSize)
      const url = `${this.basePath}/crm/v3/objects/${objectType}/batch/update`

      const response = await this._fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: batch }),
      })

      const result = await response.json() as HubSpotBatchResult

      if (result.results) {
        allResults.push(...result.results)
      }
      if (result.errors) {
        allErrors.push(...result.errors)
      }
    }

    return {
      status: 'COMPLETE',
      results: allResults,
      errors: allErrors,
    }
  }

  /**
   * Upsert records (search by unique property, then create or update)
   */
  async upsertBatch(
    objectType: HubSpotObjectType,
    uniqueProperty: string,
    records: Array<{ properties: Record<string, string> }>
  ): Promise<HubSpotBatchResult> {
    if (records.length === 0) {
      return { status: 'COMPLETE', results: [], errors: [] }
    }

    const toCreate: Array<{ properties: Record<string, string> }> = []
    const toUpdate: Array<{ id: string; properties: Record<string, string> }> = []

    // Search for existing records by unique property
    for (const record of records) {
      const uniqueValue = record.properties[uniqueProperty]
      if (!uniqueValue) {
        toCreate.push(record)
        continue
      }

      // Search for existing record
      const searchUrl = `${this.basePath}/crm/v3/objects/${objectType}/search`
      const searchResponse = await this._fetch(searchUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: uniqueProperty,
                  operator: 'EQ',
                  value: uniqueValue,
                },
              ],
            },
          ],
          limit: 1,
        }),
      })

      const searchResult = await searchResponse.json() as { results: Array<{ id: string }> }

      if (searchResult.results && searchResult.results.length > 0) {
        toUpdate.push({ id: searchResult.results[0].id, properties: record.properties })
      } else {
        toCreate.push(record)
      }
    }

    // Execute creates and updates
    const allResults: HubSpotBatchResult['results'] = []
    const allErrors: HubSpotBatchResult['errors'] = []

    if (toCreate.length > 0) {
      const createResult = await this.createBatch(objectType, toCreate)
      allResults.push(...createResult.results)
      allErrors.push(...createResult.errors)
    }

    if (toUpdate.length > 0) {
      const updateResult = await this.updateBatch(objectType, toUpdate)
      allResults.push(...updateResult.results)
      allErrors.push(...updateResult.errors)
    }

    return {
      status: 'COMPLETE',
      results: allResults,
      errors: allErrors,
    }
  }
}

// =============================================================================
// Destination Connector Definition
// =============================================================================

/**
 * Configuration spec for HubSpot destination
 */
export const HUBSPOT_DESTINATION_CONFIG_SPEC: ConfigSpec = {
  type: 'object',
  required: ['accessToken'],
  properties: {
    accessToken: {
      type: 'string',
      description: 'HubSpot private app access token or OAuth access token',
      secret: true,
    },
    basePath: {
      type: 'string',
      description: 'HubSpot API base URL (default: https://api.hubapi.com)',
      default: 'https://api.hubapi.com',
    },
    batchSize: {
      type: 'integer',
      description: 'Batch size for operations (default: 100, max: 100)',
      default: 100,
      minimum: 1,
      maximum: 100,
    },
    objectType: {
      type: 'string',
      description: 'Target HubSpot object type',
      enum: ['contacts', 'companies', 'deals'],
    },
    uniqueProperty: {
      type: 'string',
      description: 'Property to use for upsert matching (e.g., "email" for contacts)',
    },
  },
}

/**
 * HubSpot destination connector definition
 */
export const hubspotDestinationDef: DestinationConnectorDef = {
  name: 'hubspot-destination',

  spec: async (): Promise<DestinationConnectorSpec> => ({
    name: 'HubSpot Destination',
    version: '1.0.0',
    configSpec: HUBSPOT_DESTINATION_CONFIG_SPEC,
    supportedSyncModes: ['overwrite', 'append', 'append_dedup'],
    documentationUrl: 'https://developers.hubspot.com/docs/api/crm/contacts',
    releaseStage: 'generally_available',
  }),

  check: async (config: DestinationConfig): Promise<ConnectionStatus> => {
    const hsConfig = config as HubSpotDestinationConfig
    const client = new HubSpotDestinationClient(hsConfig)
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
    const hsConfig = config as HubSpotDestinationConfig & { objectType?: HubSpotObjectType; uniqueProperty?: string }
    const client = new HubSpotDestinationClient(hsConfig)

    // Determine object type from config or stream name
    const getObjectTypeForStream = (streamName: string): HubSpotObjectType => {
      if (hsConfig.objectType) return hsConfig.objectType

      // Try to infer from stream name
      const normalized = streamName.toLowerCase()
      // Check in order of specificity - deal/opportunity, then company/account, then contact
      if (normalized.includes('deal') || normalized.includes('opportunity')) return 'deals'
      // Match 'company', 'companies', 'account', 'accounts'
      if (normalized.includes('compan') || normalized.includes('account')) return 'companies'
      // Match 'contact', 'contacts'
      if (normalized.includes('contact')) return 'contacts'

      // Default to contacts
      return 'contacts'
    }

    // Get unique property for upsert
    const getUniqueProperty = (objectType: HubSpotObjectType): string | undefined => {
      if (hsConfig.uniqueProperty) return hsConfig.uniqueProperty

      // Default unique properties
      switch (objectType) {
        case 'contacts':
          return 'email'
        case 'companies':
          return 'domain'
        default:
          return undefined
      }
    }

    // Buffer for batch operations
    const recordBuffers: Map<string, Array<{ properties: Record<string, string> }>> = new Map()

    // Process messages
    for await (const message of messages) {
      if (message.type === 'RECORD') {
        const recordMessage = message as RecordMessage
        const streamName = recordMessage.record.stream
        const data = recordMessage.record.data

        // Get object type and mappings
        const objectType = getObjectTypeForStream(streamName)
        const mappings = getPropertyMappings(objectType)

        // Map the record
        const mappedProperties = mapRecordToHubSpot(data, mappings)

        // Validate required fields
        const validation = validateRecord(mappedProperties, mappings)
        if (!validation.valid) {
          yield {
            type: 'LOG',
            log: {
              level: 'WARN',
              message: `Skipping record for ${objectType}: missing required properties ${validation.missingFields.join(', ')}`,
            },
          }
          continue
        }

        // Add to buffer
        if (!recordBuffers.has(streamName)) {
          recordBuffers.set(streamName, [])
        }
        recordBuffers.get(streamName)!.push({ properties: mappedProperties })

        // Flush buffer if it reaches batch size
        const buffer = recordBuffers.get(streamName)!
        if (buffer.length >= (hsConfig.batchSize || 100)) {
          const objectTypeForBuffer = getObjectTypeForStream(streamName)
          const uniqueProperty = getUniqueProperty(objectTypeForBuffer)

          let result: HubSpotBatchResult
          if (uniqueProperty) {
            result = await client.upsertBatch(objectTypeForBuffer, uniqueProperty, buffer)
          } else {
            result = await client.createBatch(objectTypeForBuffer, buffer)
          }

          // Log results
          const successCount = result.results.length
          const errorCount = result.errors.length
          yield {
            type: 'LOG',
            log: {
              level: 'INFO',
              message: `Processed ${buffer.length} ${objectTypeForBuffer}: ${successCount} succeeded, ${errorCount} failed`,
            },
          }

          // Log any errors
          for (const error of result.errors) {
            yield {
              type: 'LOG',
              log: {
                level: 'ERROR',
                message: `HubSpot error: ${error.message} (${error.category})`,
              },
            }
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
            const uniqueProperty = getUniqueProperty(objectType)

            let result: HubSpotBatchResult
            if (uniqueProperty) {
              result = await client.upsertBatch(objectType, uniqueProperty, buffer)
            } else {
              result = await client.createBatch(objectType, buffer)
            }

            yield {
              type: 'LOG',
              log: {
                level: 'INFO',
                message: `Flushed ${buffer.length} ${objectType}: ${result.results.length} succeeded`,
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
        const uniqueProperty = getUniqueProperty(objectType)

        let result: HubSpotBatchResult
        if (uniqueProperty) {
          result = await client.upsertBatch(objectType, uniqueProperty, buffer)
        } else {
          result = await client.createBatch(objectType, buffer)
        }

        yield {
          type: 'LOG',
          log: {
            level: 'INFO',
            message: `Final flush: ${buffer.length} ${objectType}: ${result.results.length} succeeded`,
          },
        }
      }
    }
  },
}

/**
 * Create a HubSpot destination connector
 */
export function createHubSpotDestination(): DestinationConnector {
  return createDestinationConnector(hubspotDestinationDef)
}

export default createHubSpotDestination
