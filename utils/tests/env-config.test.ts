/**
 * Environment Configuration Validation Tests (do-zvk6d)
 *
 * Tests for the unified environment configuration validation module.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  validateEnv,
  validateEnvOrThrow,
  createEnvGetter,
  validateWorkerEnv,
  EnvConfigError,
  BooleanEnvSchema,
  PortSchema,
  NodeEnvSchema,
  UrlSchema,
  ApiKeySchema,
  SecretSchema,
  DurationSchema,
  CommaSeparatedListSchema,
  BaseDotdoEnvSchema,
  DOEnvSchema,
  ApiEnvSchema,
  AuthEnvSchema,
  AIEnvSchema,
  DBEnvSchema,
  DotdoEnvSchema,
  isProduction,
  isDevelopment,
  isTest,
  requireEnv,
  optionalEnv,
  z,
} from '../env-config'

describe('validateEnv', () => {
  it('should validate a simple schema', () => {
    const schema = z.object({
      PORT: z.coerce.number().int().positive(),
      HOST: z.string(),
    })

    const result = validateEnv(schema, { PORT: '3000', HOST: 'localhost' })

    expect(result.success).toBe(true)
    expect(result.env.PORT).toBe(3000)
    expect(result.env.HOST).toBe('localhost')
  })

  it('should fail with missing required variables', () => {
    const schema = z.object({
      DATABASE_URL: z.string().url(),
      API_KEY: z.string(),
    })

    const result = validateEnv(schema, {})

    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(2)
    expect(result.errors?.some((e) => e.name === 'DATABASE_URL' && e.missing)).toBe(true)
    expect(result.errors?.some((e) => e.name === 'API_KEY' && e.missing)).toBe(true)
  })

  it('should fail with invalid values', () => {
    const schema = z.object({
      PORT: z.coerce.number().int().min(1).max(65535),
    })

    const result = validateEnv(schema, { PORT: '99999' })

    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors?.[0]?.name).toBe('PORT')
    expect(result.errors?.[0]?.missing).toBe(false)
  })

  it('should apply default values', () => {
    const schema = z.object({
      PORT: z.coerce.number().default(3000),
      DEBUG: BooleanEnvSchema.default(false),
    })

    const result = validateEnv(schema, {})

    expect(result.success).toBe(true)
    expect(result.env.PORT).toBe(3000)
    expect(result.env.DEBUG).toBe(false)
  })

  it('should call custom error handler', () => {
    const schema = z.object({
      REQUIRED: z.string(),
    })

    const onError = vi.fn()
    validateEnv(schema, {}, { onError })

    expect(onError).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: 'REQUIRED', missing: true }),
      ])
    )
  })

  it('should throw when throwOnError is true', () => {
    const schema = z.object({
      REQUIRED: z.string(),
    })

    expect(() => validateEnv(schema, {}, { throwOnError: true })).toThrow(EnvConfigError)
  })
})

describe('validateEnvOrThrow', () => {
  it('should return validated env on success', () => {
    const schema = z.object({
      PORT: z.coerce.number(),
    })

    const env = validateEnvOrThrow(schema, { PORT: '3000' })

    expect(env.PORT).toBe(3000)
  })

  it('should throw EnvConfigError on failure', () => {
    const schema = z.object({
      REQUIRED: z.string(),
    })

    expect(() => validateEnvOrThrow(schema, {})).toThrow(EnvConfigError)
  })

  it('should have descriptive error message', () => {
    const schema = z.object({
      DB_URL: z.string().url(),
      API_KEY: z.string().min(32),
    })

    try {
      validateEnvOrThrow(schema, { API_KEY: 'short' })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvConfigError)
      expect((error as EnvConfigError).message).toContain('Missing: DB_URL')
      expect((error as EnvConfigError).message).toContain('Invalid: API_KEY')
    }
  })
})

describe('createEnvGetter', () => {
  it('should create a lazy validated getter', () => {
    const schema = z.object({
      VALUE: z.string(),
    })

    let callCount = 0
    const envSource = () => {
      callCount++
      return { VALUE: 'test' }
    }

    const getEnv = createEnvGetter(schema, envSource)

    // Source not called until getter is used
    expect(callCount).toBe(0)

    const env1 = getEnv()
    expect(callCount).toBe(1)
    expect(env1.VALUE).toBe('test')

    // Cached on subsequent calls
    const env2 = getEnv()
    expect(callCount).toBe(1)
    expect(env2.VALUE).toBe('test')
  })

  it('should throw on first call if invalid', () => {
    const schema = z.object({
      REQUIRED: z.string(),
    })

    const getEnv = createEnvGetter(schema, () => ({}))

    expect(() => getEnv()).toThrow(EnvConfigError)
  })
})

describe('validateWorkerEnv', () => {
  it('should validate Cloudflare Worker env bindings', () => {
    const schema = z.object({
      DO: z.any(),
      SECRET_KEY: z.string(),
    })

    const cfEnv = {
      DO: { idFromName: () => {} }, // Mock DO binding
      SECRET_KEY: 'my-secret',
    }

    const result = validateWorkerEnv(schema, cfEnv)

    expect(result.success).toBe(true)
    expect(result.env.SECRET_KEY).toBe('my-secret')
  })
})

describe('Common Schemas', () => {
  describe('BooleanEnvSchema', () => {
    it('should parse true values', () => {
      expect(BooleanEnvSchema.parse('true')).toBe(true)
      expect(BooleanEnvSchema.parse('1')).toBe(true)
      expect(BooleanEnvSchema.parse('yes')).toBe(true)
      expect(BooleanEnvSchema.parse('TRUE')).toBe(true)
      expect(BooleanEnvSchema.parse('Yes')).toBe(true)
    })

    it('should parse false values', () => {
      expect(BooleanEnvSchema.parse('false')).toBe(false)
      expect(BooleanEnvSchema.parse('0')).toBe(false)
      expect(BooleanEnvSchema.parse('no')).toBe(false)
      expect(BooleanEnvSchema.parse('')).toBe(false)
    })

    it('should pass through boolean values', () => {
      expect(BooleanEnvSchema.parse(true)).toBe(true)
      expect(BooleanEnvSchema.parse(false)).toBe(false)
    })
  })

  describe('PortSchema', () => {
    it('should validate valid ports', () => {
      expect(PortSchema.parse('3000')).toBe(3000)
      expect(PortSchema.parse('80')).toBe(80)
      expect(PortSchema.parse('443')).toBe(443)
      expect(PortSchema.parse('65535')).toBe(65535)
    })

    it('should reject invalid ports', () => {
      expect(() => PortSchema.parse('0')).toThrow()
      expect(() => PortSchema.parse('-1')).toThrow()
      expect(() => PortSchema.parse('65536')).toThrow()
      expect(() => PortSchema.parse('abc')).toThrow()
    })
  })

  describe('NodeEnvSchema', () => {
    it('should validate valid environments', () => {
      expect(NodeEnvSchema.parse('development')).toBe('development')
      expect(NodeEnvSchema.parse('production')).toBe('production')
      expect(NodeEnvSchema.parse('test')).toBe('test')
      expect(NodeEnvSchema.parse('staging')).toBe('staging')
    })

    it('should reject invalid environments', () => {
      expect(() => NodeEnvSchema.parse('invalid')).toThrow()
    })
  })

  describe('UrlSchema', () => {
    it('should validate URLs', () => {
      expect(UrlSchema.parse('https://example.com')).toBe('https://example.com')
      expect(UrlSchema.parse('http://localhost:3000')).toBe('http://localhost:3000')
    })

    it('should reject invalid URLs', () => {
      expect(() => UrlSchema.parse('not-a-url')).toThrow()
    })
  })

  describe('ApiKeySchema', () => {
    it('should validate API keys with minimum length', () => {
      expect(ApiKeySchema.parse('1234567890123456')).toBe('1234567890123456')
    })

    it('should reject short API keys', () => {
      expect(() => ApiKeySchema.parse('short')).toThrow()
    })
  })

  describe('SecretSchema', () => {
    it('should validate secrets with minimum length', () => {
      expect(SecretSchema.parse('12345678901234567890123456789012')).toBe(
        '12345678901234567890123456789012'
      )
    })

    it('should reject short secrets', () => {
      expect(() => SecretSchema.parse('short')).toThrow()
    })
  })

  describe('DurationSchema', () => {
    it('should validate duration strings', () => {
      expect(DurationSchema.parse('30s')).toBe('30s')
      expect(DurationSchema.parse('5m')).toBe('5m')
      expect(DurationSchema.parse('1h')).toBe('1h')
      expect(DurationSchema.parse('7d')).toBe('7d')
    })

    it('should reject invalid durations', () => {
      expect(() => DurationSchema.parse('30')).toThrow()
      expect(() => DurationSchema.parse('5mins')).toThrow()
    })
  })

  describe('CommaSeparatedListSchema', () => {
    it('should split comma-separated values', () => {
      expect(CommaSeparatedListSchema.parse('a,b,c')).toEqual(['a', 'b', 'c'])
      expect(CommaSeparatedListSchema.parse('a, b, c')).toEqual(['a', 'b', 'c'])
      expect(CommaSeparatedListSchema.parse('single')).toEqual(['single'])
    })

    it('should filter empty values', () => {
      expect(CommaSeparatedListSchema.parse('a,,b')).toEqual(['a', 'b'])
      expect(CommaSeparatedListSchema.parse('')).toEqual([])
    })
  })
})

describe('Dotdo-Specific Schemas', () => {
  describe('BaseDotdoEnvSchema', () => {
    it('should validate with defaults', () => {
      const result = BaseDotdoEnvSchema.safeParse({})

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.ENVIRONMENT).toBe('development')
        expect(result.data.DEBUG).toBe(false)
        expect(result.data.LOG_LEVEL).toBe('info')
      }
    })

    it('should override defaults', () => {
      const result = BaseDotdoEnvSchema.safeParse({
        ENVIRONMENT: 'production',
        DEBUG: 'true',
        LOG_LEVEL: 'error',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.ENVIRONMENT).toBe('production')
        expect(result.data.DEBUG).toBe(true)
        expect(result.data.LOG_LEVEL).toBe('error')
      }
    })
  })

  describe('DOEnvSchema', () => {
    it('should include base and DO-specific fields', () => {
      const result = DOEnvSchema.safeParse({
        DO_INTERNAL_SECRET: '12345678901234567890123456789012',
        METRICS_ENABLED: 'true',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.DO_INTERNAL_SECRET).toBeDefined()
        expect(result.data.METRICS_ENABLED).toBe(true)
      }
    })
  })

  describe('ApiEnvSchema', () => {
    it('should validate API-specific fields', () => {
      const result = ApiEnvSchema.safeParse({
        CORS_ORIGINS: 'https://app.example.com, https://admin.example.com',
        RATE_LIMIT_TIER: 'pro',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.CORS_ORIGINS).toEqual([
          'https://app.example.com',
          'https://admin.example.com',
        ])
        expect(result.data.RATE_LIMIT_TIER).toBe('pro')
      }
    })
  })

  describe('AuthEnvSchema', () => {
    it('should require JWT_SECRET', () => {
      const result = AuthEnvSchema.safeParse({})

      expect(result.success).toBe(false)
    })

    it('should validate with required fields', () => {
      const result = AuthEnvSchema.safeParse({
        JWT_SECRET: '12345678901234567890123456789012',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.JWT_ISSUER).toBe('dotdo')
        expect(result.data.TOKEN_EXPIRY).toBe('1h')
      }
    })
  })

  describe('AIEnvSchema', () => {
    it('should validate AI-specific fields', () => {
      const result = AIEnvSchema.safeParse({
        OPENAI_API_KEY: 'sk-1234567890123456',
        AI_PROVIDER: 'openai',
        AI_TIMEOUT_MS: '60000',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.AI_PROVIDER).toBe('openai')
        expect(result.data.AI_TIMEOUT_MS).toBe(60000)
      }
    })
  })

  describe('DBEnvSchema', () => {
    it('should validate DB-specific fields', () => {
      const result = DBEnvSchema.safeParse({
        DATABASE_URL: 'postgres://localhost:5432/mydb',
        DB_LOG_QUERIES: 'true',
        DB_POOL_SIZE: '20',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.DATABASE_URL).toBe('postgres://localhost:5432/mydb')
        expect(result.data.DB_LOG_QUERIES).toBe(true)
        expect(result.data.DB_POOL_SIZE).toBe(20)
      }
    })
  })

  describe('DotdoEnvSchema', () => {
    it('should validate full dotdo environment', () => {
      const result = DotdoEnvSchema.safeParse({
        ENVIRONMENT: 'production',
        DEBUG: 'false',
        AI_PROVIDER: 'anthropic',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.ENVIRONMENT).toBe('production')
        expect(result.data.AI_PROVIDER).toBe('anthropic')
      }
    })
  })
})

describe('Environment Helpers', () => {
  describe('isProduction', () => {
    it('should detect production environment', () => {
      expect(isProduction({ ENVIRONMENT: 'production' })).toBe(true)
      expect(isProduction({ NODE_ENV: 'production' })).toBe(true)
      expect(isProduction({ ENVIRONMENT: 'development' })).toBe(false)
    })
  })

  describe('isDevelopment', () => {
    it('should detect development environment', () => {
      expect(isDevelopment({ ENVIRONMENT: 'development' })).toBe(true)
      expect(isDevelopment({})).toBe(true) // Default
      expect(isDevelopment({ ENVIRONMENT: 'production' })).toBe(false)
    })
  })

  describe('isTest', () => {
    it('should detect test environment', () => {
      expect(isTest({ ENVIRONMENT: 'test' })).toBe(true)
      expect(isTest({ NODE_ENV: 'test' })).toBe(true)
      expect(isTest({ ENVIRONMENT: 'production' })).toBe(false)
    })
  })

  describe('requireEnv', () => {
    it('should return value when present', () => {
      expect(requireEnv({ API_KEY: 'my-key' }, 'API_KEY')).toBe('my-key')
    })

    it('should throw when missing', () => {
      expect(() => requireEnv({}, 'API_KEY')).toThrow(EnvConfigError)
    })

    it('should throw for empty string', () => {
      expect(() => requireEnv({ API_KEY: '' }, 'API_KEY')).toThrow(EnvConfigError)
    })
  })

  describe('optionalEnv', () => {
    it('should return value when present', () => {
      expect(optionalEnv({ PORT: '3000' }, 'PORT', 8080)).toBe(3000)
    })

    it('should return default when missing', () => {
      expect(optionalEnv({}, 'PORT', 8080)).toBe(8080)
    })

    it('should coerce to boolean', () => {
      expect(optionalEnv({ DEBUG: 'true' }, 'DEBUG', false)).toBe(true)
      expect(optionalEnv({ DEBUG: '1' }, 'DEBUG', false)).toBe(true)
      expect(optionalEnv({ DEBUG: 'false' }, 'DEBUG', true)).toBe(false)
    })

    it('should coerce to string', () => {
      expect(optionalEnv({ HOST: 'example.com' }, 'HOST', 'localhost')).toBe('example.com')
    })
  })
})

describe('EnvConfigError', () => {
  it('should include missing variables in message', () => {
    const error = new EnvConfigError([
      { name: 'DB_URL', message: 'Required', missing: true },
      { name: 'API_KEY', message: 'Required', missing: true },
    ])

    expect(error.message).toContain('Missing: DB_URL, API_KEY')
  })

  it('should include invalid variables in message', () => {
    const error = new EnvConfigError([
      { name: 'PORT', message: 'Must be positive', missing: false, value: '-1' },
    ])

    expect(error.message).toContain('Invalid: PORT (Must be positive)')
  })

  it('should include both missing and invalid', () => {
    const error = new EnvConfigError([
      { name: 'DB_URL', message: 'Required', missing: true },
      { name: 'PORT', message: 'Invalid port', missing: false },
    ])

    expect(error.message).toContain('Missing: DB_URL')
    expect(error.message).toContain('Invalid: PORT')
  })

  it('should expose errors array', () => {
    const errors = [
      { name: 'TEST', message: 'Test error', missing: true },
    ]
    const error = new EnvConfigError(errors)

    expect(error.errors).toEqual(errors)
  })
})
