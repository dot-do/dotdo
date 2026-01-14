/**
 * Config Specification and Validation Tests
 *
 * TDD RED phase tests for dotdo-y7wx2:
 * - ConfigSpec type with JSON Schema
 * - Required vs optional fields
 * - Secret field masking
 * - OAuth flow configuration
 * - Runtime validation with helpful errors
 *
 * @module db/primitives/connector-framework/config-spec.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Types
  type ConfigSpec,
  type PropertySpec,
  type OAuth2FlowConfig,
  type AuthMethodConfig,
  type ConfigValidationResult,
  type ConfigValidationError,
  // Functions
  validateConfig,
  maskSecrets,
  createConfigSpec,
  formatValidationErrors,
  validateOAuthConfig,
  mergeConfigs,
  getSecretFields,
  applyDefaults,
  coerceConfigTypes,
} from './config-spec'

// =============================================================================
// ConfigSpec Type Tests
// =============================================================================

describe('ConfigSpec Type', () => {
  describe('JSON Schema structure', () => {
    it('should define a valid JSON Schema structure', () => {
      const spec: ConfigSpec = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        title: 'PostgreSQL Connection',
        description: 'Configuration for PostgreSQL source connector',
        required: ['host', 'port', 'database'],
        properties: {
          host: {
            type: 'string',
            title: 'Host',
            description: 'Database server hostname',
            examples: ['localhost', 'db.example.com'],
          },
          port: {
            type: 'integer',
            title: 'Port',
            description: 'Database server port',
            default: 5432,
            minimum: 1,
            maximum: 65535,
          },
          database: {
            type: 'string',
            title: 'Database',
            description: 'Database name',
            minLength: 1,
          },
        },
      }

      expect(spec.$schema).toBe('http://json-schema.org/draft-07/schema#')
      expect(spec.type).toBe('object')
      expect(spec.title).toBe('PostgreSQL Connection')
      expect(spec.required).toContain('host')
      expect(spec.properties.port.default).toBe(5432)
    })

    it('should support additionalProperties constraint', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: false,
      }

      expect(spec.additionalProperties).toBe(false)
    })

    it('should support $ref for schema reuse', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          credentials: { $ref: '#/definitions/OAuth2Credentials' },
        },
        definitions: {
          OAuth2Credentials: {
            type: 'object',
            properties: {
              client_id: { type: 'string' },
              client_secret: { type: 'string', secret: true },
            },
          },
        },
      }

      expect(spec.properties.credentials.$ref).toBe('#/definitions/OAuth2Credentials')
      expect(spec.definitions?.OAuth2Credentials).toBeDefined()
    })

    it('should support if/then/else conditionals', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          auth_type: { type: 'string', enum: ['api_key', 'oauth2'] },
          api_key: { type: 'string', secret: true },
          client_id: { type: 'string' },
          client_secret: { type: 'string', secret: true },
        },
        if: {
          properties: { auth_type: { const: 'oauth2' } },
        },
        then: {
          required: ['client_id', 'client_secret'],
        },
        else: {
          required: ['api_key'],
        },
      }

      expect(spec.if).toBeDefined()
      expect(spec.then).toBeDefined()
      expect(spec.else).toBeDefined()
    })
  })

  describe('createConfigSpec', () => {
    it('should create a config spec with defaults', () => {
      const spec = createConfigSpec({
        title: 'My Connector',
        properties: {
          api_key: { type: 'string', secret: true },
        },
        required: ['api_key'],
      })

      expect(spec.$schema).toBe('http://json-schema.org/draft-07/schema#')
      expect(spec.type).toBe('object')
      expect(spec.title).toBe('My Connector')
      expect(spec.additionalProperties).toBe(false)
    })

    it('should allow overriding defaults', () => {
      const spec = createConfigSpec({
        title: 'Flexible Connector',
        properties: {},
        additionalProperties: true,
      })

      expect(spec.additionalProperties).toBe(true)
    })
  })
})

// =============================================================================
// Required vs Optional Field Tests
// =============================================================================

describe('Required vs Optional Fields', () => {
  const spec: ConfigSpec = {
    type: 'object',
    required: ['host', 'database'],
    properties: {
      host: { type: 'string' },
      port: { type: 'integer', default: 5432 },
      database: { type: 'string' },
      username: { type: 'string' },
      password: { type: 'string', secret: true },
    },
  }

  describe('validateConfig', () => {
    it('should pass when all required fields are present', () => {
      const config = { host: 'localhost', database: 'mydb' }
      const result = validateConfig(config, spec)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail when required fields are missing', () => {
      const config = { host: 'localhost' }
      const result = validateConfig(config, spec)

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].path).toBe('database')
      expect(result.errors[0].code).toBe('required')
    })

    it('should fail when multiple required fields are missing', () => {
      const config = {}
      const result = validateConfig(config, spec)

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(2)
      expect(result.errors.map((e) => e.path)).toContain('host')
      expect(result.errors.map((e) => e.path)).toContain('database')
    })

    it('should pass when optional fields are missing', () => {
      const config = { host: 'localhost', database: 'mydb' }
      const result = validateConfig(config, spec)

      expect(result.valid).toBe(true)
    })

    it('should accept optional fields when provided', () => {
      const config = {
        host: 'localhost',
        database: 'mydb',
        port: 5433,
        username: 'admin',
        password: 'secret',
      }
      const result = validateConfig(config, spec)

      expect(result.valid).toBe(true)
    })

    it('should not fail on undefined optional fields', () => {
      const config = { host: 'localhost', database: 'mydb', username: undefined }
      const result = validateConfig(config, spec)

      expect(result.valid).toBe(true)
    })

    it('should fail when required field is null', () => {
      const config = { host: null, database: 'mydb' }
      const result = validateConfig(config, spec)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path === 'host')).toBe(true)
    })

    it('should fail when required field is empty string (with minLength)', () => {
      const strictSpec: ConfigSpec = {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
        },
      }

      const config = { name: '' }
      const result = validateConfig(config, strictSpec)

      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('range')
    })
  })

  describe('applyDefaults', () => {
    it('should apply default values to missing optional fields', () => {
      const config = { host: 'localhost', database: 'mydb' }
      const withDefaults = applyDefaults(config, spec)

      expect(withDefaults.host).toBe('localhost')
      expect(withDefaults.database).toBe('mydb')
      expect(withDefaults.port).toBe(5432)
    })

    it('should not override explicitly provided values', () => {
      const config = { host: 'localhost', database: 'mydb', port: 5433 }
      const withDefaults = applyDefaults(config, spec)

      expect(withDefaults.port).toBe(5433)
    })

    it('should handle nested object defaults', () => {
      const nestedSpec: ConfigSpec = {
        type: 'object',
        properties: {
          connection: {
            type: 'object',
            properties: {
              timeout: { type: 'integer', default: 30000 },
              retries: { type: 'integer', default: 3 },
            },
          },
        },
      }

      const config = { connection: { timeout: 5000 } }
      const withDefaults = applyDefaults(config, nestedSpec)

      expect((withDefaults.connection as Record<string, unknown>).timeout).toBe(5000)
      expect((withDefaults.connection as Record<string, unknown>).retries).toBe(3)
    })

    it('should apply defaults to empty nested objects', () => {
      const nestedSpec: ConfigSpec = {
        type: 'object',
        properties: {
          options: {
            type: 'object',
            default: { enabled: true },
            properties: {
              enabled: { type: 'boolean' },
            },
          },
        },
      }

      const config = {}
      const withDefaults = applyDefaults(config, nestedSpec)

      expect(withDefaults.options).toEqual({ enabled: true })
    })

    it('should apply array defaults', () => {
      const arraySpec: ConfigSpec = {
        type: 'object',
        properties: {
          tags: { type: 'array', default: ['default'], items: { type: 'string' } },
        },
      }

      const config = {}
      const withDefaults = applyDefaults(config, arraySpec)

      expect(withDefaults.tags).toEqual(['default'])
    })
  })
})

// =============================================================================
// Secret Field Masking Tests
// =============================================================================

describe('Secret Field Masking', () => {
  describe('maskSecrets', () => {
    it('should mask fields marked with secret: true', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          host: { type: 'string' },
          password: { type: 'string', secret: true },
        },
      }

      const config = { host: 'localhost', password: 'super-secret-123' }
      const masked = maskSecrets(config, spec)

      expect(masked.host).toBe('localhost')
      expect(masked.password).toBe('******')
    })

    it('should mask fields marked with airbyte_secret: true', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          api_key: { type: 'string', airbyte_secret: true },
        },
      }

      const config = { api_key: 'sk-1234567890' }
      const masked = maskSecrets(config, spec)

      expect(masked.api_key).toBe('******')
    })

    it('should mask nested secret fields', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          credentials: {
            type: 'object',
            properties: {
              username: { type: 'string' },
              password: { type: 'string', secret: true },
              token: { type: 'string', secret: true },
            },
          },
        },
      }

      const config = {
        credentials: {
          username: 'admin',
          password: 'secret123',
          token: 'abc-xyz',
        },
      }
      const masked = maskSecrets(config, spec)

      expect((masked.credentials as Record<string, unknown>).username).toBe('admin')
      expect((masked.credentials as Record<string, unknown>).password).toBe('******')
      expect((masked.credentials as Record<string, unknown>).token).toBe('******')
    })

    it('should handle custom mask string', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          secret: { type: 'string', secret: true },
        },
      }

      const config = { secret: 'value' }
      const masked = maskSecrets(config, spec, '[REDACTED]')

      expect(masked.secret).toBe('[REDACTED]')
    })

    it('should preserve non-secret fields unchanged', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          host: { type: 'string' },
          port: { type: 'integer' },
          enabled: { type: 'boolean' },
        },
      }

      const config = { host: 'localhost', port: 5432, enabled: true }
      const masked = maskSecrets(config, spec)

      expect(masked).toEqual(config)
    })

    it('should handle arrays with objects containing secrets', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          connections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                token: { type: 'string', secret: true },
              },
            },
          },
        },
      }

      const config = {
        connections: [
          { name: 'conn1', token: 'secret1' },
          { name: 'conn2', token: 'secret2' },
        ],
      }
      const masked = maskSecrets(config, spec)

      const maskedConns = masked.connections as Array<Record<string, unknown>>
      expect(maskedConns[0].name).toBe('conn1')
      expect(maskedConns[0].token).toBe('******')
      expect(maskedConns[1].name).toBe('conn2')
      expect(maskedConns[1].token).toBe('******')
    })

    it('should handle missing fields gracefully', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          host: { type: 'string' },
          password: { type: 'string', secret: true },
        },
      }

      const config = { host: 'localhost' } // password not provided
      const masked = maskSecrets(config, spec)

      expect(masked.host).toBe('localhost')
      expect(masked.password).toBeUndefined()
    })

    it('should handle null secret values', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          token: { type: 'string', secret: true },
        },
      }

      const config = { token: null }
      const masked = maskSecrets(config, spec)

      expect(masked.token).toBe(null)
    })
  })

  describe('getSecretFields', () => {
    it('should return paths to all secret fields', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          host: { type: 'string' },
          password: { type: 'string', secret: true },
          credentials: {
            type: 'object',
            properties: {
              api_key: { type: 'string', secret: true },
              token: { type: 'string', airbyte_secret: true },
            },
          },
        },
      }

      const secretPaths = getSecretFields(spec)

      expect(secretPaths).toContain('password')
      expect(secretPaths).toContain('credentials.api_key')
      expect(secretPaths).toContain('credentials.token')
      expect(secretPaths).not.toContain('host')
    })

    it('should handle specs with no secrets', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          host: { type: 'string' },
          port: { type: 'integer' },
        },
      }

      const secretPaths = getSecretFields(spec)

      expect(secretPaths).toHaveLength(0)
    })
  })
})

// =============================================================================
// OAuth Flow Configuration Tests
// =============================================================================

describe('OAuth Flow Configuration', () => {
  describe('OAuth2FlowConfig', () => {
    it('should define standard OAuth2 authorization code flow', () => {
      const oauthConfig: OAuth2FlowConfig = {
        type: 'oauth2',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
        refreshUrl: 'https://oauth2.googleapis.com/token',
        pkceRequired: false,
      }

      expect(oauthConfig.type).toBe('oauth2')
      expect(oauthConfig.authorizationUrl).toContain('oauth2/auth')
      expect(oauthConfig.scopes).toContain('https://www.googleapis.com/auth/drive.readonly')
    })

    it('should support PKCE flow', () => {
      const oauthConfig: OAuth2FlowConfig = {
        type: 'oauth2',
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scopes: ['repo', 'user'],
        pkceRequired: true,
      }

      expect(oauthConfig.pkceRequired).toBe(true)
    })
  })

  describe('AuthMethodConfig', () => {
    it('should support multiple auth methods', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          credentials: {
            type: 'object',
            oneOf: [
              {
                type: 'object',
                title: 'API Key',
                properties: {
                  auth_type: { type: 'string', const: 'api_key' },
                  api_key: { type: 'string', secret: true },
                },
                required: ['auth_type', 'api_key'],
              },
              {
                type: 'object',
                title: 'OAuth 2.0',
                properties: {
                  auth_type: { type: 'string', const: 'oauth2' },
                  client_id: { type: 'string' },
                  client_secret: { type: 'string', secret: true },
                  refresh_token: { type: 'string', secret: true },
                },
                required: ['auth_type', 'client_id', 'client_secret'],
              },
            ],
          },
        },
        authMethods: [
          { type: 'api_key' },
          {
            type: 'oauth2',
            oauth2: {
              type: 'oauth2',
              authorizationUrl: 'https://api.example.com/oauth/authorize',
              tokenUrl: 'https://api.example.com/oauth/token',
              scopes: ['read', 'write'],
            },
          },
        ],
      }

      expect(spec.authMethods).toHaveLength(2)
      expect(spec.authMethods![0].type).toBe('api_key')
      expect(spec.authMethods![1].oauth2?.authorizationUrl).toContain('/oauth/authorize')
    })
  })

  describe('validateOAuthConfig', () => {
    it('should validate OAuth2 credentials have required fields', () => {
      const oauthSpec: OAuth2FlowConfig = {
        type: 'oauth2',
        authorizationUrl: 'https://api.example.com/oauth/authorize',
        tokenUrl: 'https://api.example.com/oauth/token',
        scopes: ['read'],
      }

      const validConfig = {
        client_id: 'my-client-id',
        client_secret: 'my-client-secret',
        refresh_token: 'my-refresh-token',
      }

      const result = validateOAuthConfig(validConfig, oauthSpec)
      expect(result.valid).toBe(true)
    })

    it('should fail when OAuth2 credentials are incomplete', () => {
      const oauthSpec: OAuth2FlowConfig = {
        type: 'oauth2',
        authorizationUrl: 'https://api.example.com/oauth/authorize',
        tokenUrl: 'https://api.example.com/oauth/token',
        scopes: ['read'],
      }

      const incompleteConfig = {
        client_id: 'my-client-id',
        // missing client_secret
      }

      const result = validateOAuthConfig(incompleteConfig, oauthSpec)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.message.includes('client_secret'))).toBe(true)
    })

    it('should validate authorization URL is a valid URL', () => {
      const oauthSpec: OAuth2FlowConfig = {
        type: 'oauth2',
        authorizationUrl: 'not-a-valid-url',
        tokenUrl: 'https://api.example.com/oauth/token',
        scopes: [],
      }

      const result = validateOAuthConfig({}, oauthSpec)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.message.includes('authorization'))).toBe(true)
    })

    it('should validate token URL is a valid URL', () => {
      const oauthSpec: OAuth2FlowConfig = {
        type: 'oauth2',
        authorizationUrl: 'https://api.example.com/oauth/authorize',
        tokenUrl: 'invalid-url',
        scopes: [],
      }

      const result = validateOAuthConfig({}, oauthSpec)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.message.includes('token'))).toBe(true)
    })
  })
})

// =============================================================================
// Runtime Validation with Helpful Errors
// =============================================================================

describe('Runtime Validation with Helpful Errors', () => {
  describe('formatValidationErrors', () => {
    it('should format single error with clear message', () => {
      const errors: ConfigValidationError[] = [
        { path: 'host', message: "Missing required field 'host'", code: 'required' },
      ]

      const formatted = formatValidationErrors(errors)

      expect(formatted).toContain('host')
      expect(formatted).toContain('required')
    })

    it('should format multiple errors with numbered list', () => {
      const errors: ConfigValidationError[] = [
        { path: 'host', message: "Missing required field 'host'", code: 'required' },
        { path: 'port', message: 'Expected type integer, got string', code: 'type' },
        { path: 'email', message: "String does not match format 'email'", code: 'format' },
      ]

      const formatted = formatValidationErrors(errors)

      expect(formatted).toContain('1.')
      expect(formatted).toContain('2.')
      expect(formatted).toContain('3.')
    })

    it('should include field path in error message', () => {
      const errors: ConfigValidationError[] = [
        { path: 'connection.ssl.certificate', message: "Missing required field 'certificate'", code: 'required' },
      ]

      const formatted = formatValidationErrors(errors)

      expect(formatted).toContain('connection.ssl.certificate')
    })

    it('should provide actionable suggestions for common errors', () => {
      const errors: ConfigValidationError[] = [
        { path: 'port', message: 'Value 70000 exceeds maximum 65535', code: 'range' },
      ]

      const formatted = formatValidationErrors(errors)

      expect(formatted).toContain('port')
      expect(formatted).toContain('65535')
    })

    it('should handle empty error array', () => {
      const formatted = formatValidationErrors([])

      expect(formatted).toBe('')
    })
  })

  describe('validation error messages', () => {
    it('should provide helpful message for type errors', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          port: { type: 'integer', description: 'Database port number' },
        },
      }

      const result = validateConfig({ port: 'not-a-number' }, spec)

      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toContain('integer')
      expect(result.errors[0].message).toContain('string')
    })

    it('should provide helpful message for enum errors', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          environment: {
            type: 'string',
            enum: ['development', 'staging', 'production'],
          },
        },
      }

      const result = validateConfig({ environment: 'dev' }, spec)

      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toContain('development')
      expect(result.errors[0].message).toContain('staging')
      expect(result.errors[0].message).toContain('production')
    })

    it('should provide helpful message for pattern errors', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          api_key: {
            type: 'string',
            pattern: '^sk-[a-zA-Z0-9]{32}$',
            description: 'API key in format sk-<32 alphanumeric chars>',
          },
        },
      }

      const result = validateConfig({ api_key: 'invalid-key' }, spec)

      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('pattern')
    })

    it('should provide helpful message for format errors with examples', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            format: 'email',
            examples: ['user@example.com'],
          },
        },
      }

      const result = validateConfig({ email: 'not-an-email' }, spec)

      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('format')
    })

    it('should provide helpful message for range errors', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          timeout: {
            type: 'integer',
            minimum: 1000,
            maximum: 60000,
            description: 'Timeout in milliseconds (1-60 seconds)',
          },
        },
      }

      const result = validateConfig({ timeout: 500 }, spec)

      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toContain('1000')
    })

    it('should aggregate all errors rather than failing fast', () => {
      const spec: ConfigSpec = {
        type: 'object',
        required: ['host', 'port', 'database'],
        properties: {
          host: { type: 'string' },
          port: { type: 'integer', minimum: 1, maximum: 65535 },
          database: { type: 'string', minLength: 1 },
        },
      }

      const result = validateConfig({ port: 'invalid', database: '' }, spec)

      expect(result.valid).toBe(false)
      // Should have error for: missing host, port type, database minLength
      expect(result.errors.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('coerceConfigTypes', () => {
    it('should coerce string to integer when spec says integer', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          port: { type: 'integer' },
        },
      }

      const config = { port: '5432' }
      const coerced = coerceConfigTypes(config, spec)

      expect(coerced.port).toBe(5432)
      expect(typeof coerced.port).toBe('number')
    })

    it('should coerce string to number when spec says number', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          rate: { type: 'number' },
        },
      }

      const config = { rate: '3.14' }
      const coerced = coerceConfigTypes(config, spec)

      expect(coerced.rate).toBe(3.14)
    })

    it('should coerce string to boolean when spec says boolean', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
        },
      }

      expect(coerceConfigTypes({ enabled: 'true' }, spec).enabled).toBe(true)
      expect(coerceConfigTypes({ enabled: 'false' }, spec).enabled).toBe(false)
      expect(coerceConfigTypes({ enabled: '1' }, spec).enabled).toBe(true)
      expect(coerceConfigTypes({ enabled: '0' }, spec).enabled).toBe(false)
    })

    it('should not coerce when types already match', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          port: { type: 'integer' },
          name: { type: 'string' },
        },
      }

      const config = { port: 5432, name: 'test' }
      const coerced = coerceConfigTypes(config, spec)

      expect(coerced.port).toBe(5432)
      expect(coerced.name).toBe('test')
    })

    it('should handle nested objects', () => {
      const spec: ConfigSpec = {
        type: 'object',
        properties: {
          connection: {
            type: 'object',
            properties: {
              timeout: { type: 'integer' },
            },
          },
        },
      }

      const config = { connection: { timeout: '30000' } }
      const coerced = coerceConfigTypes(config, spec)

      expect((coerced.connection as Record<string, unknown>).timeout).toBe(30000)
    })
  })

  describe('mergeConfigs', () => {
    it('should merge two config objects with later taking precedence', () => {
      const base = { host: 'localhost', port: 5432 }
      const override = { port: 5433, database: 'mydb' }

      const merged = mergeConfigs(base, override)

      expect(merged.host).toBe('localhost')
      expect(merged.port).toBe(5433)
      expect(merged.database).toBe('mydb')
    })

    it('should deep merge nested objects', () => {
      const base = {
        connection: { host: 'localhost', port: 5432 },
        options: { timeout: 30000 },
      }
      const override = {
        connection: { port: 5433 },
      }

      const merged = mergeConfigs(base, override)

      expect((merged.connection as Record<string, unknown>).host).toBe('localhost')
      expect((merged.connection as Record<string, unknown>).port).toBe(5433)
      expect((merged.options as Record<string, unknown>).timeout).toBe(30000)
    })

    it('should handle null/undefined values appropriately', () => {
      const base = { host: 'localhost', port: 5432 }
      const override = { host: null, port: undefined }

      const merged = mergeConfigs(base, override)

      // null should override, undefined should not
      expect(merged.host).toBe(null)
      expect(merged.port).toBe(5432)
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Config Spec Integration', () => {
  it('should handle full Stripe connector configuration', () => {
    const stripeSpec: ConfigSpec = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      title: 'Stripe Source Configuration',
      description: 'Configuration for Stripe source connector',
      required: ['account_id', 'credentials'],
      properties: {
        account_id: {
          type: 'string',
          title: 'Account ID',
          description: 'Your Stripe account ID',
          pattern: '^acct_[a-zA-Z0-9]+$',
          examples: ['acct_1234567890'],
        },
        credentials: {
          type: 'object',
          title: 'Credentials',
          oneOf: [
            {
              type: 'object',
              title: 'API Key',
              properties: {
                auth_type: { type: 'string', const: 'api_key' },
                api_key: {
                  type: 'string',
                  secret: true,
                  title: 'API Key',
                  pattern: '^sk_[a-zA-Z]+_[a-zA-Z0-9]+$',
                },
              },
              required: ['auth_type', 'api_key'],
            },
          ],
        },
        start_date: {
          type: 'string',
          format: 'date',
          title: 'Start Date',
          description: 'Date to start syncing from',
          default: '2020-01-01',
        },
        lookback_window_days: {
          type: 'integer',
          title: 'Lookback Window',
          description: 'Number of days to look back for updated records',
          minimum: 0,
          maximum: 365,
          default: 0,
        },
      },
      authMethods: [
        { type: 'api_key' },
      ],
    }

    // Valid config
    const validConfig = {
      account_id: 'acct_1234567890',
      credentials: {
        auth_type: 'api_key',
        api_key: 'sk_test_1234567890abcdef',
      },
      start_date: '2023-01-01',
    }

    const result = validateConfig(validConfig, stripeSpec)
    expect(result.valid).toBe(true)

    // Masked config
    const masked = maskSecrets(validConfig, stripeSpec)
    expect(masked.account_id).toBe('acct_1234567890')
    expect((masked.credentials as Record<string, unknown>).api_key).toBe('******')

    // With defaults
    const withDefaults = applyDefaults(validConfig, stripeSpec)
    expect(withDefaults.lookback_window_days).toBe(0)
  })

  it('should handle Google Sheets OAuth connector configuration', () => {
    const sheetsSpec: ConfigSpec = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      title: 'Google Sheets Source Configuration',
      required: ['spreadsheet_id', 'credentials'],
      properties: {
        spreadsheet_id: {
          type: 'string',
          title: 'Spreadsheet ID',
          description: 'The ID of the Google Spreadsheet',
        },
        credentials: {
          type: 'object',
          title: 'Authentication',
          oneOf: [
            {
              type: 'object',
              title: 'Service Account',
              properties: {
                auth_type: { type: 'string', const: 'service_account' },
                service_account_info: { type: 'string', secret: true },
              },
              required: ['auth_type', 'service_account_info'],
            },
            {
              type: 'object',
              title: 'OAuth 2.0',
              properties: {
                auth_type: { type: 'string', const: 'oauth2' },
                client_id: { type: 'string' },
                client_secret: { type: 'string', secret: true },
                refresh_token: { type: 'string', secret: true },
              },
              required: ['auth_type', 'client_id', 'client_secret', 'refresh_token'],
            },
          ],
        },
      },
      authMethods: [
        { type: 'api_key' },
        {
          type: 'oauth2',
          oauth2: {
            type: 'oauth2',
            authorizationUrl: 'https://accounts.google.com/o/oauth2/auth',
            tokenUrl: 'https://oauth2.googleapis.com/token',
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
            refreshUrl: 'https://oauth2.googleapis.com/token',
          },
        },
      ],
    }

    const validOAuthConfig = {
      spreadsheet_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
      credentials: {
        auth_type: 'oauth2',
        client_id: '123456789.apps.googleusercontent.com',
        client_secret: 'secret-key',
        refresh_token: 'refresh-token-value',
      },
    }

    const result = validateConfig(validOAuthConfig, sheetsSpec)
    expect(result.valid).toBe(true)

    const secretFields = getSecretFields(sheetsSpec)
    expect(secretFields).toContain('credentials.service_account_info')
    expect(secretFields).toContain('credentials.client_secret')
    expect(secretFields).toContain('credentials.refresh_token')
  })

  it('should provide clear errors for misconfigured connector', () => {
    const spec: ConfigSpec = {
      type: 'object',
      required: ['api_url', 'api_key'],
      properties: {
        api_url: {
          type: 'string',
          format: 'uri',
          description: 'The base URL for the API',
          examples: ['https://api.example.com/v1'],
        },
        api_key: {
          type: 'string',
          secret: true,
          minLength: 10,
          description: 'Your API key (minimum 10 characters)',
        },
        timeout_ms: {
          type: 'integer',
          minimum: 1000,
          maximum: 60000,
          default: 30000,
        },
      },
    }

    const badConfig = {
      api_url: 'not-a-url',
      api_key: 'short',
      timeout_ms: 500,
    }

    const result = validateConfig(badConfig, spec)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBe(3)

    const formatted = formatValidationErrors(result.errors)
    expect(formatted).toContain('api_url')
    expect(formatted).toContain('api_key')
    expect(formatted).toContain('timeout_ms')
  })
})
