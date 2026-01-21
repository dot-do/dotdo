/**
 * Utility functions for @dotdo/do package
 *
 * @module do/utils
 */

export {
  createNestedProxy,
  createMethodProxy,
  createCallableNestedProxy,
} from './proxy'

export {
  validateOrigin,
  validateMethods,
  validateOriginConfig,
  isValidOriginFormat,
  logCORSWarnings,
  isProductionEnvironment,
  buildHonoCorsOptions,
  DEFAULT_CORS_METHODS,
  DEFAULT_CORS_HEADERS,
  DEFAULT_EXPOSE_HEADERS,
  VALID_HTTP_METHODS,
  type OriginValidationResult,
} from './cors'
