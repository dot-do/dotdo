/**
 * Config Specification and Validation
 *
 * Implements JSON Schema-based configuration specification and validation
 * for connector configurations with support for:
 * - Required vs optional fields
 * - Secret field masking
 * - OAuth flow configuration
 * - Runtime validation with helpful errors
 *
 * @module db/primitives/connector-framework/config-spec
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Property specification for config schema (JSON Schema compatible)
 */
export interface PropertySpec {
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array'
  description?: string
  title?: string
  secret?: boolean
  airbyte_secret?: boolean
  format?: string
  const?: string | number | boolean
  default?: unknown
  enum?: unknown[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  properties?: Record<string, PropertySpec>
  items?: PropertySpec
  oneOf?: PropertySpec[]
  required?: string[]
  examples?: unknown[]
  order?: number
  $ref?: string
}

/**
 * OAuth2 flow configuration
 */
export interface OAuth2FlowConfig {
  type: 'oauth2'
  authorizationUrl: string
  tokenUrl: string
  scopes: string[]
  refreshUrl?: string
  pkceRequired?: boolean
}

/**
 * Authentication method configuration
 */
export interface AuthMethodConfig {
  type: 'api_key' | 'oauth2' | 'basic' | 'bearer'
  oauth2?: OAuth2FlowConfig
}

/**
 * Configuration specification (JSON Schema-like)
 */
export interface ConfigSpec {
  $schema?: string
  type: 'object'
  title?: string
  description?: string
  required?: string[]
  properties: Record<string, PropertySpec>
  additionalProperties?: boolean
  definitions?: Record<string, PropertySpec>
  if?: { properties: Record<string, PropertySpec> }
  then?: { required?: string[] }
  else?: { required?: string[] }
  // OAuth and advanced auth support
  authMethods?: AuthMethodConfig[]
  // Additional metadata for UI generation
  groups?: Array<{
    id: string
    title: string
    fields: string[]
  }>
}

/**
 * Config validation error
 */
export interface ConfigValidationError {
  path: string
  message: string
  code: 'required' | 'type' | 'format' | 'pattern' | 'enum' | 'range' | 'custom'
}

/**
 * Config validation result
 */
export interface ConfigValidationResult {
  valid: boolean
  errors: ConfigValidationError[]
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a config spec with sensible defaults
 */
export function createConfigSpec(options: {
  title?: string
  description?: string
  properties: Record<string, PropertySpec>
  required?: string[]
  additionalProperties?: boolean
  authMethods?: AuthMethodConfig[]
  definitions?: Record<string, PropertySpec>
}): ConfigSpec {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    title: options.title,
    description: options.description,
    required: options.required,
    properties: options.properties,
    additionalProperties: options.additionalProperties ?? false,
    authMethods: options.authMethods,
    definitions: options.definitions,
  }
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate a property value against its spec
 */
function validateProperty(
  value: unknown,
  spec: PropertySpec,
  path: string,
): ConfigValidationError[] {
  const errors: ConfigValidationError[] = []

  // Handle null separately
  if (value === null) {
    // null is treated as missing for required field validation
    return errors
  }

  // Skip validation for undefined values (handled by required check)
  if (value === undefined) {
    return errors
  }

  // Type validation
  const actualType = Array.isArray(value) ? 'array' : typeof value
  const expectedType = spec.type === 'integer' ? 'number' : spec.type

  if (expectedType && actualType !== expectedType) {
    errors.push({
      path,
      message: `Expected type '${spec.type}', got '${actualType}'`,
      code: 'type',
    })
    return errors // Skip further validation if type is wrong
  }

  // Integer check
  if (spec.type === 'integer' && typeof value === 'number' && !Number.isInteger(value)) {
    errors.push({
      path,
      message: `Expected integer, got float`,
      code: 'type',
    })
  }

  // String validations
  if (spec.type === 'string' && typeof value === 'string') {
    if (spec.minLength !== undefined && value.length < spec.minLength) {
      errors.push({
        path,
        message: `String length ${value.length} is less than minimum ${spec.minLength}`,
        code: 'range',
      })
    }
    if (spec.maxLength !== undefined && value.length > spec.maxLength) {
      errors.push({
        path,
        message: `String length ${value.length} exceeds maximum ${spec.maxLength}`,
        code: 'range',
      })
    }
    if (spec.pattern && !new RegExp(spec.pattern).test(value)) {
      errors.push({
        path,
        message: `String does not match pattern '${spec.pattern}'`,
        code: 'pattern',
      })
    }
    if (spec.format) {
      const formatValidators: Record<string, (v: string) => boolean> = {
        email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        uri: (v) => {
          try {
            new URL(v)
            return true
          } catch {
            return false
          }
        },
        'date-time': (v) => !isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v),
        date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
      }
      const validator = formatValidators[spec.format]
      if (validator && !validator(value)) {
        errors.push({
          path,
          message: `String does not match format '${spec.format}'`,
          code: 'format',
        })
      }
    }
  }

  // Number validations
  if ((spec.type === 'number' || spec.type === 'integer') && typeof value === 'number') {
    if (spec.minimum !== undefined && value < spec.minimum) {
      errors.push({
        path,
        message: `Value ${value} is less than minimum ${spec.minimum}`,
        code: 'range',
      })
    }
    if (spec.maximum !== undefined && value > spec.maximum) {
      errors.push({
        path,
        message: `Value ${value} exceeds maximum ${spec.maximum}`,
        code: 'range',
      })
    }
  }

  // Enum validation
  if (spec.enum && !spec.enum.includes(value)) {
    errors.push({
      path,
      message: `Value must be one of: ${spec.enum.join(', ')}`,
      code: 'enum',
    })
  }

  // Const validation
  if (spec.const !== undefined && value !== spec.const) {
    errors.push({
      path,
      message: `Value must be '${spec.const}'`,
      code: 'enum',
    })
  }

  // Object validation
  if (spec.type === 'object' && spec.properties && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>

    // Check required fields
    if (spec.required) {
      for (const field of spec.required) {
        if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
          errors.push({
            path: path ? `${path}.${field}` : field,
            message: `Missing required field '${field}'`,
            code: 'required',
          })
        }
      }
    }

    // Validate nested properties
    for (const [key, propSpec] of Object.entries(spec.properties)) {
      if (key in obj) {
        errors.push(...validateProperty(obj[key], propSpec, path ? `${path}.${key}` : key))
      }
    }
  }

  // Array validation
  if (spec.type === 'array' && spec.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      errors.push(...validateProperty(value[i], spec.items, `${path}[${i}]`))
    }
  }

  return errors
}

/**
 * Validate a configuration against a config spec
 */
export function validateConfig(
  config: Record<string, unknown>,
  spec: ConfigSpec,
): ConfigValidationResult {
  const errors: ConfigValidationError[] = []

  // Check required fields at root level
  if (spec.required) {
    for (const field of spec.required) {
      if (!(field in config) || config[field] === undefined || config[field] === null) {
        errors.push({
          path: field,
          message: `Missing required field '${field}'`,
          code: 'required',
        })
      }
    }
  }

  // Validate each property
  for (const [key, propSpec] of Object.entries(spec.properties)) {
    if (key in config) {
      errors.push(...validateProperty(config[key], propSpec, key))
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// =============================================================================
// Secret Masking Functions
// =============================================================================

/**
 * Mask secret values in a configuration
 */
export function maskSecrets(
  config: Record<string, unknown>,
  spec: ConfigSpec,
  mask: string = '******',
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(config)) {
    const propSpec = spec.properties[key]

    if (!propSpec) {
      result[key] = value
      continue
    }

    // Handle null values - don't mask them
    if (value === null) {
      result[key] = null
      continue
    }

    // Handle undefined values
    if (value === undefined) {
      continue
    }

    if (propSpec.secret || propSpec.airbyte_secret) {
      result[key] = mask
    } else if (propSpec.type === 'object' && propSpec.properties && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = maskSecrets(value as Record<string, unknown>, {
        type: 'object',
        properties: propSpec.properties,
        required: propSpec.required,
      }, mask)
    } else if (propSpec.type === 'object' && propSpec.oneOf && typeof value === 'object' && !Array.isArray(value)) {
      // Handle oneOf - mask secrets from all possible schemas
      const combinedProperties: Record<string, PropertySpec> = {}
      for (const variant of propSpec.oneOf) {
        if (variant.properties) {
          Object.assign(combinedProperties, variant.properties)
        }
      }
      result[key] = maskSecrets(value as Record<string, unknown>, {
        type: 'object',
        properties: combinedProperties,
      }, mask)
    } else if (propSpec.type === 'array' && propSpec.items && Array.isArray(value)) {
      // Handle arrays with objects containing secrets
      if (propSpec.items.type === 'object' && propSpec.items.properties) {
        result[key] = value.map((item) => {
          if (typeof item === 'object' && item !== null) {
            return maskSecrets(item as Record<string, unknown>, {
              type: 'object',
              properties: propSpec.items!.properties!,
            }, mask)
          }
          return item
        })
      } else {
        result[key] = value
      }
    } else {
      result[key] = value
    }
  }

  return result
}

/**
 * Get paths to all secret fields in a config spec
 */
export function getSecretFields(spec: ConfigSpec, prefix: string = ''): string[] {
  const paths: string[] = []

  for (const [key, propSpec] of Object.entries(spec.properties)) {
    const path = prefix ? `${prefix}.${key}` : key

    if (propSpec.secret || propSpec.airbyte_secret) {
      paths.push(path)
    }

    if (propSpec.type === 'object' && propSpec.properties) {
      paths.push(...getSecretFields({
        type: 'object',
        properties: propSpec.properties,
      }, path))
    }

    // Handle oneOf for polymorphic configs
    if (propSpec.oneOf) {
      for (const variant of propSpec.oneOf) {
        if (variant.properties) {
          paths.push(...getSecretFields({
            type: 'object',
            properties: variant.properties,
          }, path))
        }
      }
    }
  }

  return paths
}

// =============================================================================
// OAuth Validation Functions
// =============================================================================

/**
 * Validate OAuth configuration
 */
export function validateOAuthConfig(
  config: Record<string, unknown>,
  oauthSpec: OAuth2FlowConfig,
): ConfigValidationResult {
  const errors: ConfigValidationError[] = []

  // Validate authorization URL
  try {
    new URL(oauthSpec.authorizationUrl)
  } catch {
    errors.push({
      path: 'authorizationUrl',
      message: 'Invalid authorization URL',
      code: 'format',
    })
  }

  // Validate token URL
  try {
    new URL(oauthSpec.tokenUrl)
  } catch {
    errors.push({
      path: 'tokenUrl',
      message: 'Invalid token URL',
      code: 'format',
    })
  }

  // Validate required OAuth credentials
  if (!config.client_id) {
    errors.push({
      path: 'client_id',
      message: "Missing required OAuth field 'client_id'",
      code: 'required',
    })
  }

  if (!config.client_secret) {
    errors.push({
      path: 'client_secret',
      message: "Missing required OAuth field 'client_secret'",
      code: 'required',
    })
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// =============================================================================
// Error Formatting Functions
// =============================================================================

/**
 * Format validation errors into a human-readable string
 */
export function formatValidationErrors(errors: ConfigValidationError[]): string {
  if (errors.length === 0) {
    return ''
  }

  if (errors.length === 1) {
    const error = errors[0]
    return `Validation error at '${error.path}': ${error.message}`
  }

  const lines = ['Configuration validation failed with the following errors:']
  errors.forEach((error, index) => {
    lines.push(`  ${index + 1}. ${error.path}: ${error.message}`)
  })

  return lines.join('\n')
}

// =============================================================================
// Default Application Functions
// =============================================================================

/**
 * Apply default values from spec to config
 */
export function applyDefaults(
  config: Record<string, unknown>,
  spec: ConfigSpec,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...config }

  for (const [key, propSpec] of Object.entries(spec.properties)) {
    // Apply default if key is missing
    if (!(key in result) || result[key] === undefined) {
      if (propSpec.default !== undefined) {
        result[key] = JSON.parse(JSON.stringify(propSpec.default)) // Deep clone default
      }
    } else if (propSpec.type === 'object' && propSpec.properties && typeof result[key] === 'object' && result[key] !== null) {
      // Recursively apply defaults to nested objects
      result[key] = applyDefaults(result[key] as Record<string, unknown>, {
        type: 'object',
        properties: propSpec.properties,
      })
    }
  }

  return result
}

// =============================================================================
// Type Coercion Functions
// =============================================================================

/**
 * Coerce config values to match expected types from spec
 */
export function coerceConfigTypes(
  config: Record<string, unknown>,
  spec: ConfigSpec,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...config }

  for (const [key, propSpec] of Object.entries(spec.properties)) {
    if (!(key in result) || result[key] === undefined || result[key] === null) {
      continue
    }

    const value = result[key]

    // Coerce string to integer
    if (propSpec.type === 'integer' && typeof value === 'string') {
      const parsed = parseInt(value, 10)
      if (!isNaN(parsed)) {
        result[key] = parsed
      }
    }

    // Coerce string to number
    if (propSpec.type === 'number' && typeof value === 'string') {
      const parsed = parseFloat(value)
      if (!isNaN(parsed)) {
        result[key] = parsed
      }
    }

    // Coerce string to boolean
    if (propSpec.type === 'boolean' && typeof value === 'string') {
      result[key] = value === 'true' || value === '1'
    }

    // Recursively handle nested objects
    if (propSpec.type === 'object' && propSpec.properties && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = coerceConfigTypes(value as Record<string, unknown>, {
        type: 'object',
        properties: propSpec.properties,
      })
    }
  }

  return result
}

// =============================================================================
// Config Merging Functions
// =============================================================================

/**
 * Deep merge two config objects, with later taking precedence
 */
export function mergeConfigs(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }

  for (const [key, value] of Object.entries(override)) {
    // undefined doesn't override
    if (value === undefined) {
      continue
    }

    // null explicitly overrides
    if (value === null) {
      result[key] = null
      continue
    }

    // Deep merge objects
    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = mergeConfigs(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      )
    } else {
      result[key] = value
    }
  }

  return result
}
