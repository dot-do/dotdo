/**
 * API Documentation Generators for DataContract
 *
 * Generate OpenAPI 3.1 and AsyncAPI 2.6 specifications from DataContract definitions.
 *
 * Features:
 * - OpenAPI 3.1 generation for REST endpoints
 * - AsyncAPI 2.6 generation for event streams
 * - Example generation from schema defaults
 * - Deprecation notices from version metadata
 *
 * @example
 * ```typescript
 * import { generateDocs, generateOpenAPIDocument, generateAsyncAPIDocument } from './generators'
 *
 * const contracts = [userContract, orderContract]
 *
 * // Generate both OpenAPI and AsyncAPI
 * const { openapi, asyncapi } = generateDocs(contracts, {
 *   openapi: { title: 'My API', version: '1.0.0' },
 *   asyncapi: { title: 'My Events', version: '1.0.0' }
 * })
 *
 * // Or generate individually
 * const openapiDoc = generateOpenAPIDocument(contracts, { title: 'My API' })
 * const asyncapiDoc = generateAsyncAPIDocument(contracts, { title: 'My Events' })
 * ```
 */

// OpenAPI exports
export {
  toOpenAPISchema,
  toOpenAPIPath,
  generateOpenAPIDocument,
  generateExample,
} from './openapi'

export type {
  OpenAPIDocument,
  OpenAPIInfo,
  OpenAPIServer,
  OpenAPITag,
  OpenAPIPathItem,
  OpenAPIOperation,
  OpenAPIParameter,
  OpenAPIRequestBody,
  OpenAPIResponse,
  OpenAPIMediaType,
  OpenAPISchema,
  OpenAPIComponents,
  OpenAPISecurityScheme,
  CRUDOperations,
  OpenAPIGeneratorOptions,
} from './openapi'

// AsyncAPI exports
export {
  toAsyncAPISchema,
  toAsyncAPIMessage,
  toAsyncAPIChannel,
  toAsyncAPIEventChannels,
  generateAsyncAPIDocument,
  generateDocs,
} from './asyncapi'

export type {
  AsyncAPIDocument,
  AsyncAPIInfo,
  AsyncAPIServer,
  AsyncAPITag,
  AsyncAPIChannel,
  AsyncAPIOperation,
  AsyncAPIParameter,
  AsyncAPIMessage,
  AsyncAPISchema,
  AsyncAPIComponents,
  AsyncAPISecurityScheme,
  EventOperations,
  ChannelConfig,
  AsyncAPIGeneratorOptions,
  DocGeneratorOptions,
} from './asyncapi'
