/**
 * Destination Adapters
 *
 * Pre-built destination connectors for popular SaaS platforms.
 *
 * @module db/primitives/connector-framework/destinations
 */

// Salesforce
export {
  createSalesforceDestination,
  salesforceDestinationDef,
  SalesforceDestinationClient,
  SalesforceDestinationError,
  mapRecordToSalesforce,
  validateRecord as validateSalesforceRecord,
  getFieldMappings as getSalesforceFieldMappings,
  CONTACT_FIELD_MAPPINGS as SALESFORCE_CONTACT_MAPPINGS,
  LEAD_FIELD_MAPPINGS as SALESFORCE_LEAD_MAPPINGS,
  ACCOUNT_FIELD_MAPPINGS as SALESFORCE_ACCOUNT_MAPPINGS,
  OPPORTUNITY_FIELD_MAPPINGS as SALESFORCE_OPPORTUNITY_MAPPINGS,
  SALESFORCE_DESTINATION_CONFIG_SPEC,
} from './salesforce'

export type {
  SalesforceDestinationConfig,
  SalesforceObjectType,
  SalesforceFieldMapping,
  SalesforceUpsertOptions,
  SalesforceWriteResult,
} from './salesforce'

// HubSpot
export {
  createHubSpotDestination,
  hubspotDestinationDef,
  HubSpotDestinationClient,
  HubSpotDestinationError,
  mapRecordToHubSpot,
  validateRecord as validateHubSpotRecord,
  getPropertyMappings as getHubSpotPropertyMappings,
  CONTACT_PROPERTY_MAPPINGS as HUBSPOT_CONTACT_MAPPINGS,
  COMPANY_PROPERTY_MAPPINGS as HUBSPOT_COMPANY_MAPPINGS,
  DEAL_PROPERTY_MAPPINGS as HUBSPOT_DEAL_MAPPINGS,
  HUBSPOT_DESTINATION_CONFIG_SPEC,
} from './hubspot'

export type {
  HubSpotDestinationConfig,
  HubSpotObjectType,
  HubSpotPropertyMapping,
  HubSpotWriteResult,
  HubSpotBatchResult,
} from './hubspot'
