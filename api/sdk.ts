// SDK code generation - see do-7rf.7.5
//
// Two generation modes:
// 1. From ResourceDefinition[] - generateSDK()
// 2. From OpenAPI spec - generateSDKFromOpenAPI()

export {
  // Resource-based SDK generation
  generateSDK,
  SDKGenerator,
  type SDKGeneratorOptions,

  // OpenAPI-based SDK generation
  generateSDKFromOpenAPI,
  SDKFromOpenAPIGenerator,
  type SDKFromOpenAPIOptions
} from './codegen/sdk'
