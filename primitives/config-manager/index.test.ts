import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ConfigManager,
  EnvLoader,
  FileLoader,
  SecretManager,
  SchemaValidator,
  ConfigMerger,
  ChangeNotifier,
} from './index'
import type {
  ConfigSchema,
  ConfigObject,
  ConfigChangeEvent,
  ValidationResult,
} from './types'

describe('ConfigManager', () => {
  describe('basic get/set operations', () => {
    it('should create an empty config manager', () => {
      const config = new ConfigManager()
      expect(config).toBeInstanceOf(ConfigManager)
    })

    it('should set and get a simple string value', () => {
      const config = new ConfigManager()
      config.set('name', 'dotdo')
      expect(config.get('name')).toBe('dotdo')
    })

    it('should set and get a number value', () => {
      const config = new ConfigManager()
      config.set('port', 3000)
      expect(config.get('port')).toBe(3000)
    })

    it('should set and get a boolean value', () => {
      const config = new ConfigManager()
      config.set('debug', true)
      expect(config.get('debug')).toBe(true)
    })

    it('should return undefined for non-existent keys', () => {
      const config = new ConfigManager()
      expect(config.get('nonexistent')).toBeUndefined()
    })

    it('should overwrite existing values', () => {
      const config = new ConfigManager()
      config.set('name', 'old')
      config.set('name', 'new')
      expect(config.get('name')).toBe('new')
    })

    it('should accept initial values in constructor', () => {
      const config = new ConfigManager({ initial: { name: 'dotdo', port: 3000 } })
      expect(config.get('name')).toBe('dotdo')
      expect(config.get('port')).toBe(3000)
    })

    it('should set and get object values', () => {
      const config = new ConfigManager()
      config.set('database', { host: 'localhost', port: 5432 })
      expect(config.get('database')).toEqual({ host: 'localhost', port: 5432 })
    })

    it('should set and get array values', () => {
      const config = new ConfigManager()
      config.set('features', ['auth', 'api', 'dashboard'])
      expect(config.get('features')).toEqual(['auth', 'api', 'dashboard'])
    })
  })

  describe('nested key access (dot notation)', () => {
    it('should get nested values using dot notation', () => {
      const config = new ConfigManager({
        initial: {
          database: {
            host: 'localhost',
            port: 5432,
          },
        },
      })
      expect(config.get('database.host')).toBe('localhost')
      expect(config.get('database.port')).toBe(5432)
    })

    it('should set nested values using dot notation', () => {
      const config = new ConfigManager()
      config.set('database.host', 'localhost')
      config.set('database.port', 5432)
      expect(config.get('database')).toEqual({ host: 'localhost', port: 5432 })
    })

    it('should handle deeply nested values', () => {
      const config = new ConfigManager()
      config.set('a.b.c.d.e', 'deep')
      expect(config.get('a.b.c.d.e')).toBe('deep')
      expect(config.get('a.b.c.d')).toEqual({ e: 'deep' })
    })

    it('should return undefined for non-existent nested keys', () => {
      const config = new ConfigManager({ initial: { database: { host: 'localhost' } } })
      expect(config.get('database.nonexistent')).toBeUndefined()
      expect(config.get('nonexistent.deep.path')).toBeUndefined()
    })

    it('should overwrite nested values', () => {
      const config = new ConfigManager({
        initial: { database: { host: 'localhost', port: 5432 } },
      })
      config.set('database.host', 'production.db.com')
      expect(config.get('database.host')).toBe('production.db.com')
      expect(config.get('database.port')).toBe(5432)
    })
  })

  describe('EnvLoader', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('should load environment variables', async () => {
      process.env.APP_NAME = 'dotdo'
      process.env.APP_PORT = '3000'

      const loader = new EnvLoader({ prefix: 'APP_' })
      const config = await loader.load()

      expect(config.NAME).toBe('dotdo')
      expect(config.PORT).toBe('3000')
    })

    it('should handle nested keys with separator', async () => {
      process.env.APP_DATABASE__HOST = 'localhost'
      process.env.APP_DATABASE__PORT = '5432'

      const loader = new EnvLoader({ prefix: 'APP_', separator: '__' })
      const config = await loader.load()

      expect(config.DATABASE).toEqual({ HOST: 'localhost', PORT: '5432' })
    })

    it('should convert keys to lowercase when option is set', async () => {
      process.env.APP_NAME = 'dotdo'

      const loader = new EnvLoader({ prefix: 'APP_', lowercase: true })
      const config = await loader.load()

      expect(config.name).toBe('dotdo')
    })

    it('should load all env vars when no prefix is specified', async () => {
      process.env.TEST_VAR = 'test'

      const loader = new EnvLoader()
      const config = await loader.load()

      expect(config.TEST_VAR).toBe('test')
    })

    it('should have correct source type', () => {
      const loader = new EnvLoader()
      expect(loader.source).toBe('env')
    })
  })

  describe('FileLoader', () => {
    it('should load JSON configuration', async () => {
      const loader = new FileLoader({
        path: '/mock/config.json',
        format: 'json',
      })

      // Mock the file content
      loader.setMockContent(JSON.stringify({ name: 'dotdo', port: 3000 }))

      const config = await loader.load()
      expect(config).toEqual({ name: 'dotdo', port: 3000 })
    })

    it('should load YAML-like configuration', async () => {
      const loader = new FileLoader({
        path: '/mock/config.yaml',
        format: 'yaml',
      })

      // Mock YAML content (simple key: value format)
      loader.setMockContent(`
name: dotdo
port: 3000
debug: true
`)

      const config = await loader.load()
      expect(config.name).toBe('dotdo')
      expect(config.port).toBe(3000)
      expect(config.debug).toBe(true)
    })

    it('should auto-detect format from file extension', async () => {
      const jsonLoader = new FileLoader({ path: '/mock/config.json' })
      expect(jsonLoader.detectedFormat).toBe('json')

      const yamlLoader = new FileLoader({ path: '/mock/config.yaml' })
      expect(yamlLoader.detectedFormat).toBe('yaml')

      const ymlLoader = new FileLoader({ path: '/mock/config.yml' })
      expect(ymlLoader.detectedFormat).toBe('yaml')
    })

    it('should have correct source type', () => {
      const loader = new FileLoader({ path: '/mock/config.json' })
      expect(loader.source).toBe('file')
    })
  })

  describe('default values', () => {
    it('should return default value for missing key', () => {
      const config = new ConfigManager({
        schema: {
          fields: {
            port: { type: 'number', default: 3000 },
          },
        },
      })

      expect(config.get('port')).toBe(3000)
    })

    it('should not use default if value is set', () => {
      const config = new ConfigManager({
        schema: {
          fields: {
            port: { type: 'number', default: 3000 },
          },
        },
        initial: { port: 8080 },
      })

      expect(config.get('port')).toBe(8080)
    })

    it('should support schema-level defaults', () => {
      const config = new ConfigManager({
        schema: {
          fields: {},
          defaults: {
            name: 'default-app',
            debug: false,
          },
        },
      })

      expect(config.get('name')).toBe('default-app')
      expect(config.get('debug')).toBe(false)
    })
  })

  describe('required field validation', () => {
    it('should validate required fields', () => {
      const config = new ConfigManager({
        schema: {
          fields: {
            apiKey: { type: 'string', required: true },
          },
        },
      })

      const result = config.validate()
      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'apiKey',
          message: expect.stringContaining('required'),
        })
      )
    })

    it('should pass validation when required fields are present', () => {
      const config = new ConfigManager({
        schema: {
          fields: {
            apiKey: { type: 'string', required: true },
          },
        },
        initial: { apiKey: 'secret123' },
      })

      const result = config.validate()
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should support schema-level required array', () => {
      const config = new ConfigManager({
        schema: {
          fields: {
            host: { type: 'string' },
            port: { type: 'number' },
          },
          required: ['host', 'port'],
        },
        initial: { host: 'localhost' },
      })

      const result = config.validate()
      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'port' })
      )
    })
  })

  describe('type coercion', () => {
    it('should coerce string to number', () => {
      const config = new ConfigManager({
        schema: {
          fields: {
            port: { type: 'number' },
          },
        },
        initial: { port: '3000' },
      })

      expect(config.get('port')).toBe(3000)
    })

    it('should coerce string to boolean', () => {
      const config = new ConfigManager({
        schema: {
          fields: {
            debug: { type: 'boolean' },
          },
        },
        initial: { debug: 'true' },
      })

      expect(config.get('debug')).toBe(true)
    })

    it('should coerce various boolean strings', () => {
      const schema: ConfigSchema = {
        fields: {
          flag1: { type: 'boolean' },
          flag2: { type: 'boolean' },
          flag3: { type: 'boolean' },
          flag4: { type: 'boolean' },
        },
      }

      const config = new ConfigManager({
        schema,
        initial: {
          flag1: 'true',
          flag2: 'false',
          flag3: '1',
          flag4: '0',
        },
      })

      expect(config.get('flag1')).toBe(true)
      expect(config.get('flag2')).toBe(false)
      expect(config.get('flag3')).toBe(true)
      expect(config.get('flag4')).toBe(false)
    })

    it('should parse JSON strings to objects', () => {
      const config = new ConfigManager({
        schema: {
          fields: {
            options: { type: 'object' },
          },
        },
        initial: { options: '{"key":"value"}' },
      })

      expect(config.get('options')).toEqual({ key: 'value' })
    })
  })

  describe('custom validators', () => {
    it('should run custom validator function', () => {
      const config = new ConfigManager({
        schema: {
          fields: {
            port: {
              type: 'number',
              validate: (value) => {
                const num = value as number
                return num >= 1 && num <= 65535
              },
            },
          },
        },
        initial: { port: 70000 },
      })

      const result = config.validate()
      expect(result.valid).toBe(false)
    })

    it('should accept custom error message from validator', () => {
      const config = new ConfigManager({
        schema: {
          fields: {
            email: {
              type: 'string',
              validate: (value) => {
                const str = value as string
                return str.includes('@') || 'Invalid email format'
              },
            },
          },
        },
        initial: { email: 'invalid' },
      })

      const result = config.validate()
      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toBe('Invalid email format')
    })

    it('should pass validation with valid custom validator', () => {
      const config = new ConfigManager({
        schema: {
          fields: {
            port: {
              type: 'number',
              validate: (value) => (value as number) >= 1 && (value as number) <= 65535,
            },
          },
        },
        initial: { port: 3000 },
      })

      const result = config.validate()
      expect(result.valid).toBe(true)
    })
  })

  describe('SecretManager', () => {
    it('should load secrets from DO secrets provider', async () => {
      const secretManager = new SecretManager()
      secretManager.setMockSecret('do-secrets', 'API_KEY', 'secret123')

      const value = await secretManager.get({
        provider: 'do-secrets',
        key: 'API_KEY',
      })

      expect(value).toBe('secret123')
    })

    it('should load secrets from KV provider', async () => {
      const secretManager = new SecretManager()
      secretManager.setMockSecret('kv', 'DB_PASSWORD', 'dbpass456')

      const value = await secretManager.get({
        provider: 'kv',
        key: 'DB_PASSWORD',
      })

      expect(value).toBe('dbpass456')
    })

    it('should support versioned secrets', async () => {
      const secretManager = new SecretManager()
      secretManager.setMockSecret('do-secrets', 'API_KEY', 'v1-secret', 'v1')
      secretManager.setMockSecret('do-secrets', 'API_KEY', 'v2-secret', 'v2')

      const v1 = await secretManager.get({
        provider: 'do-secrets',
        key: 'API_KEY',
        version: 'v1',
      })

      const v2 = await secretManager.get({
        provider: 'do-secrets',
        key: 'API_KEY',
        version: 'v2',
      })

      expect(v1).toBe('v1-secret')
      expect(v2).toBe('v2-secret')
    })

    it('should return undefined for non-existent secrets', async () => {
      const secretManager = new SecretManager()
      const value = await secretManager.get({
        provider: 'do-secrets',
        key: 'NONEXISTENT',
      })

      expect(value).toBeUndefined()
    })
  })

  describe('ConfigMerger', () => {
    it('should merge two config objects', () => {
      const merger = new ConfigMerger()
      const result = merger.merge(
        { name: 'app', port: 3000 },
        { port: 8080, debug: true }
      )

      expect(result).toEqual({ name: 'app', port: 8080, debug: true })
    })

    it('should deep merge nested objects', () => {
      const merger = new ConfigMerger({ strategy: 'deep' })
      const result = merger.merge(
        { database: { host: 'localhost', port: 5432 } },
        { database: { port: 3306, user: 'admin' } }
      )

      expect(result).toEqual({
        database: { host: 'localhost', port: 3306, user: 'admin' },
      })
    })

    it('should replace nested objects with replace strategy', () => {
      const merger = new ConfigMerger({ strategy: 'replace' })
      const result = merger.merge(
        { database: { host: 'localhost', port: 5432 } },
        { database: { port: 3306 } }
      )

      expect(result).toEqual({ database: { port: 3306 } })
    })

    it('should concat arrays with concat strategy', () => {
      const merger = new ConfigMerger({ strategy: 'concat' })
      const result = merger.merge(
        { features: ['auth', 'api'] },
        { features: ['dashboard'] }
      )

      expect(result).toEqual({ features: ['auth', 'api', 'dashboard'] })
    })

    it('should clone objects when clone option is true', () => {
      const merger = new ConfigMerger({ clone: true })
      const original = { nested: { value: 1 } }
      const result = merger.merge(original, {})

      result.nested.value = 2
      expect(original.nested.value).toBe(1)
    })
  })

  describe('ChangeNotifier and watch functionality', () => {
    it('should notify on value change', () => {
      const config = new ConfigManager()
      const listener = vi.fn()

      config.watch('name', listener)
      config.set('name', 'dotdo')

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'name',
          oldValue: undefined,
          newValue: 'dotdo',
        })
      )
    })

    it('should notify with old and new values', () => {
      const config = new ConfigManager({ initial: { name: 'old' } })
      const listener = vi.fn()

      config.watch('name', listener)
      config.set('name', 'new')

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          oldValue: 'old',
          newValue: 'new',
        })
      )
    })

    it('should support wildcard watchers', () => {
      const config = new ConfigManager()
      const listener = vi.fn()

      config.watch('*', listener)
      config.set('name', 'dotdo')
      config.set('port', 3000)

      expect(listener).toHaveBeenCalledTimes(2)
    })

    it('should support nested key watchers', () => {
      const config = new ConfigManager()
      const listener = vi.fn()

      config.watch('database.host', listener)
      config.set('database.host', 'localhost')

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'database.host',
          newValue: 'localhost',
        })
      )
    })

    it('should unwatch listeners', () => {
      const config = new ConfigManager()
      const listener = vi.fn()

      const unwatch = config.watch('name', listener)
      config.set('name', 'first')
      unwatch()
      config.set('name', 'second')

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('should include timestamp in change event', () => {
      const config = new ConfigManager()
      const listener = vi.fn()

      config.watch('name', listener)
      const before = Date.now()
      config.set('name', 'dotdo')
      const after = Date.now()

      const event = listener.mock.calls[0][0] as ConfigChangeEvent
      expect(event.timestamp).toBeGreaterThanOrEqual(before)
      expect(event.timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('SchemaValidator', () => {
    it('should validate type constraints', () => {
      const validator = new SchemaValidator({
        fields: {
          name: { type: 'string' },
          port: { type: 'number' },
          debug: { type: 'boolean' },
        },
      })

      const result = validator.validate({
        name: 123,
        port: 'not a number',
        debug: 'not a boolean',
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(3)
    })

    it('should validate required fields', () => {
      const validator = new SchemaValidator({
        fields: {
          apiKey: { type: 'string', required: true },
          optional: { type: 'string' },
        },
      })

      const result = validator.validate({ optional: 'value' })

      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'apiKey' })
      )
    })

    it('should pass validation for valid config', () => {
      const validator = new SchemaValidator({
        fields: {
          name: { type: 'string', required: true },
          port: { type: 'number' },
        },
      })

      const result = validator.validate({ name: 'app', port: 3000 })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate nested object fields', () => {
      const validator = new SchemaValidator({
        fields: {
          database: { type: 'object' },
        },
      })

      const result = validator.validate({ database: 'not an object' })

      expect(result.valid).toBe(false)
    })

    it('should validate array fields', () => {
      const validator = new SchemaValidator({
        fields: {
          features: { type: 'array' },
        },
      })

      const result = validator.validate({ features: 'not an array' })

      expect(result.valid).toBe(false)
    })
  })

  describe('export/import', () => {
    it('should export all config values', () => {
      const config = new ConfigManager({
        initial: { name: 'dotdo', port: 3000 },
      })

      const exported = config.export()

      expect(exported.values).toEqual({ name: 'dotdo', port: 3000 })
      expect(exported.exportedAt).toBeGreaterThan(0)
      expect(exported.version).toBeDefined()
    })

    it('should include schema in export if available', () => {
      const schema: ConfigSchema = {
        fields: {
          name: { type: 'string' },
        },
      }

      const config = new ConfigManager({ schema, initial: { name: 'dotdo' } })
      const exported = config.export()

      expect(exported.schema).toEqual(schema)
    })

    it('should import config from exported format', () => {
      const config = new ConfigManager()

      config.import({
        values: { name: 'imported', port: 8080 },
        exportedAt: Date.now(),
        version: '1.0.0',
      })

      expect(config.get('name')).toBe('imported')
      expect(config.get('port')).toBe(8080)
    })

    it('should merge imported config with existing', () => {
      const config = new ConfigManager({ initial: { name: 'original', debug: true } })

      config.import({
        values: { name: 'imported', port: 8080 },
        exportedAt: Date.now(),
        version: '1.0.0',
      })

      expect(config.get('name')).toBe('imported')
      expect(config.get('port')).toBe(8080)
      expect(config.get('debug')).toBe(true)
    })
  })

  describe('ConfigManager.load()', () => {
    it('should load from EnvLoader', async () => {
      process.env.TEST_NAME = 'from-env'

      const config = new ConfigManager()
      const loader = new EnvLoader({ prefix: 'TEST_' })

      await config.load(loader)

      expect(config.get('NAME')).toBe('from-env')

      delete process.env.TEST_NAME
    })

    it('should load from FileLoader', async () => {
      const config = new ConfigManager()
      const loader = new FileLoader({ path: '/mock/config.json' })
      loader.setMockContent(JSON.stringify({ name: 'from-file' }))

      await config.load(loader)

      expect(config.get('name')).toBe('from-file')
    })

    it('should merge loaded config with existing', async () => {
      const config = new ConfigManager({ initial: { existing: true } })
      const loader = new FileLoader({ path: '/mock/config.json' })
      loader.setMockContent(JSON.stringify({ loaded: true }))

      await config.load(loader)

      expect(config.get('existing')).toBe(true)
      expect(config.get('loaded')).toBe(true)
    })
  })

  describe('strict mode', () => {
    it('should throw on validation error in strict mode', () => {
      const config = new ConfigManager({
        schema: {
          fields: {
            apiKey: { type: 'string', required: true },
          },
        },
        strict: true,
      })

      expect(() => config.validate()).toThrow()
    })

    it('should throw on set with invalid value in strict mode', () => {
      const config = new ConfigManager({
        schema: {
          fields: {
            port: {
              type: 'number',
              validate: (v) => (v as number) > 0 && (v as number) <= 65535,
            },
          },
        },
        strict: true,
        validateOnSet: true,
      })

      expect(() => config.set('port', 70000)).toThrow()
    })
  })
})
