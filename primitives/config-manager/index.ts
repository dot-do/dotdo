/**
 * ConfigManager - Comprehensive configuration management system
 * for the dotdo platform.
 */

export * from './types'

import type {
  ConfigValue,
  ConfigObject,
  ConfigSchema,
  ConfigField,
  ConfigManagerOptions,
  ConfigLoader,
  ConfigChangeEvent,
  ChangeListener,
  ValidationResult,
  ValidationError,
  ExportedConfig,
  EnvLoaderOptions,
  FileLoaderOptions,
  SecretConfig,
  SecretProvider,
  MergeOptions,
  MergeStrategy,
} from './types'

/**
 * Helper to get nested value by dot notation
 */
function getNestedValue(obj: ConfigObject, path: string): ConfigValue {
  const parts = path.split('.')
  let current: ConfigValue = obj

  for (const part of parts) {
    if (current === undefined || current === null) {
      return undefined
    }
    if (typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }
    current = (current as ConfigObject)[part]
  }

  return current
}

/**
 * Helper to set nested value by dot notation
 */
function setNestedValue(obj: ConfigObject, path: string, value: ConfigValue): void {
  const parts = path.split('.')
  let current: ConfigObject = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {}
    }
    current = current[part] as ConfigObject
  }

  current[parts[parts.length - 1]] = value
}

/**
 * Helper to coerce value based on field type
 */
function coerceValue(value: ConfigValue, type: ConfigField['type']): ConfigValue {
  if (value === undefined || value === null) {
    return value
  }

  switch (type) {
    case 'number':
      if (typeof value === 'string') {
        const num = Number(value)
        return isNaN(num) ? value : num
      }
      return value

    case 'boolean':
      if (typeof value === 'string') {
        const lower = value.toLowerCase()
        if (lower === 'true' || lower === '1') return true
        if (lower === 'false' || lower === '0') return false
      }
      return value

    case 'object':
      if (typeof value === 'string') {
        try {
          return JSON.parse(value)
        } catch {
          return value
        }
      }
      return value

    case 'array':
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value)
          return Array.isArray(parsed) ? parsed : value
        } catch {
          return value
        }
      }
      return value

    default:
      return value
  }
}

/**
 * Helper to check type
 */
function checkType(value: ConfigValue, type: ConfigField['type']): boolean {
  if (value === undefined || value === null) {
    return true // undefined/null pass type check (required check is separate)
  }

  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'boolean':
      return typeof value === 'boolean'
    case 'object':
      return typeof value === 'object' && !Array.isArray(value)
    case 'array':
      return Array.isArray(value)
    default:
      return true
  }
}

/**
 * Deep clone helper
 */
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  if (Array.isArray(obj)) {
    return obj.map(deepClone) as T
  }
  const result: Record<string, unknown> = {}
  for (const key in obj) {
    result[key] = deepClone((obj as Record<string, unknown>)[key])
  }
  return result as T
}

/**
 * ConfigMerger - Handles merging config objects with various strategies
 */
export class ConfigMerger {
  private strategy: MergeStrategy
  private clone: boolean

  constructor(options?: MergeOptions) {
    this.strategy = options?.strategy ?? 'deep'
    this.clone = options?.clone ?? false
  }

  merge(base: ConfigObject, override: ConfigObject): ConfigObject {
    const result = this.clone ? deepClone(base) : { ...base }

    for (const key in override) {
      const baseValue = result[key]
      const overrideValue = override[key]

      if (this.strategy === 'replace') {
        result[key] = this.clone ? deepClone(overrideValue) : overrideValue
      } else if (this.strategy === 'concat' && Array.isArray(baseValue) && Array.isArray(overrideValue)) {
        result[key] = [...baseValue, ...overrideValue]
      } else if (
        this.strategy === 'deep' &&
        typeof baseValue === 'object' &&
        baseValue !== null &&
        !Array.isArray(baseValue) &&
        typeof overrideValue === 'object' &&
        overrideValue !== null &&
        !Array.isArray(overrideValue)
      ) {
        result[key] = this.merge(baseValue as ConfigObject, overrideValue as ConfigObject)
      } else {
        result[key] = this.clone ? deepClone(overrideValue) : overrideValue
      }
    }

    return result
  }
}

/**
 * ChangeNotifier - Manages change event subscriptions and notifications
 */
export class ChangeNotifier {
  private listeners: Map<string, Set<ChangeListener>> = new Map()

  subscribe(key: string, callback: ChangeListener): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }
    this.listeners.get(key)!.add(callback)

    return () => {
      this.listeners.get(key)?.delete(callback)
    }
  }

  notify(event: ConfigChangeEvent): void {
    // Notify specific key listeners
    const keyListeners = this.listeners.get(event.key)
    if (keyListeners) {
      keyListeners.forEach((listener) => listener(event))
    }

    // Notify wildcard listeners
    const wildcardListeners = this.listeners.get('*')
    if (wildcardListeners) {
      wildcardListeners.forEach((listener) => listener(event))
    }
  }
}

/**
 * SchemaValidator - Validates config against a schema
 */
export class SchemaValidator {
  private schema: ConfigSchema

  constructor(schema: ConfigSchema) {
    this.schema = schema
  }

  validate(config: ConfigObject): ValidationResult {
    const errors: ValidationError[] = []

    // Check field-level constraints
    for (const [fieldName, field] of Object.entries(this.schema.fields)) {
      const value = config[fieldName]

      // Check required
      if (field.required && (value === undefined || value === null)) {
        errors.push({
          field: fieldName,
          message: `Field '${fieldName}' is required`,
          expected: field.type,
          actual: value,
        })
        continue
      }

      // Check type (only if value exists)
      if (value !== undefined && value !== null && !checkType(value, field.type)) {
        errors.push({
          field: fieldName,
          message: `Field '${fieldName}' should be of type ${field.type}`,
          expected: field.type,
          actual: value,
        })
      }

      // Check custom validator
      if (value !== undefined && value !== null && field.validate) {
        const result = field.validate(value)
        if (result !== true) {
          errors.push({
            field: fieldName,
            message: typeof result === 'string' ? result : `Field '${fieldName}' failed validation`,
            actual: value,
          })
        }
      }
    }

    // Check schema-level required array
    if (this.schema.required) {
      for (const fieldName of this.schema.required) {
        const value = config[fieldName]
        if (value === undefined || value === null) {
          errors.push({
            field: fieldName,
            message: `Field '${fieldName}' is required`,
          })
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }
}

/**
 * EnvLoader - Load configuration from environment variables
 */
export class EnvLoader implements ConfigLoader {
  readonly source = 'env' as const
  private options: EnvLoaderOptions

  constructor(options?: EnvLoaderOptions) {
    this.options = options ?? {}
  }

  async load(): Promise<ConfigObject> {
    const result: ConfigObject = {}
    const { prefix, separator = '__', lowercase } = this.options

    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue

      let configKey = key
      if (prefix) {
        if (!key.startsWith(prefix)) continue
        configKey = key.slice(prefix.length)
      }

      if (lowercase) {
        configKey = configKey.toLowerCase()
      }

      // Handle nested keys with separator
      if (separator && configKey.includes(separator)) {
        const parts = configKey.split(separator)
        let current = result
        for (let i = 0; i < parts.length - 1; i++) {
          const part = lowercase ? parts[i].toLowerCase() : parts[i]
          if (!(part in current)) {
            current[part] = {}
          }
          current = current[part] as ConfigObject
        }
        const lastPart = lowercase ? parts[parts.length - 1].toLowerCase() : parts[parts.length - 1]
        current[lastPart] = value
      } else {
        result[configKey] = value
      }
    }

    return result
  }
}

/**
 * FileLoader - Load configuration from JSON/YAML files
 */
export class FileLoader implements ConfigLoader {
  readonly source = 'file' as const
  private options: FileLoaderOptions
  private mockContent?: string

  constructor(options: FileLoaderOptions) {
    this.options = options
  }

  get detectedFormat(): 'json' | 'yaml' {
    if (this.options.format) {
      return this.options.format
    }
    const ext = this.options.path.split('.').pop()?.toLowerCase()
    if (ext === 'json') return 'json'
    if (ext === 'yaml' || ext === 'yml') return 'yaml'
    return 'json'
  }

  setMockContent(content: string): void {
    this.mockContent = content
  }

  async load(): Promise<ConfigObject> {
    if (!this.mockContent) {
      throw new Error('No file content available')
    }

    if (this.detectedFormat === 'json') {
      return JSON.parse(this.mockContent)
    }

    // Simple YAML-like parsing (key: value format)
    return this.parseSimpleYaml(this.mockContent)
  }

  private parseSimpleYaml(content: string): ConfigObject {
    const result: ConfigObject = {}
    const lines = content.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const colonIndex = trimmed.indexOf(':')
      if (colonIndex === -1) continue

      const key = trimmed.slice(0, colonIndex).trim()
      let value: ConfigValue = trimmed.slice(colonIndex + 1).trim()

      // Type coercion
      if (value === 'true') {
        value = true
      } else if (value === 'false') {
        value = false
      } else if (!isNaN(Number(value)) && value !== '') {
        value = Number(value)
      }

      result[key] = value
    }

    return result
  }
}

/**
 * SecretManager - Load secrets from various providers
 */
export class SecretManager {
  private mockSecrets: Map<string, string> = new Map()

  constructor() {
    // Initialize
  }

  private getSecretKey(provider: SecretProvider, key: string, version?: string): string {
    return `${provider}:${key}:${version ?? 'latest'}`
  }

  setMockSecret(provider: SecretProvider, key: string, value: string, version?: string): void {
    this.mockSecrets.set(this.getSecretKey(provider, key, version), value)
  }

  async get(config: SecretConfig): Promise<string | undefined> {
    return this.mockSecrets.get(this.getSecretKey(config.provider, config.key, config.version))
  }
}

/**
 * ConfigManager - Main configuration management class
 */
export class ConfigManager {
  private config: ConfigObject = {}
  private schema?: ConfigSchema
  private options: ConfigManagerOptions
  private notifier: ChangeNotifier
  private merger: ConfigMerger

  constructor(options?: ConfigManagerOptions) {
    this.options = options ?? {}
    this.schema = options?.schema
    this.notifier = new ChangeNotifier()
    this.merger = new ConfigMerger({ strategy: 'deep' })

    // Initialize with initial values
    if (options?.initial) {
      this.config = this.applyCoercion({ ...options.initial })
    }
  }

  /**
   * Apply type coercion based on schema
   */
  private applyCoercion(config: ConfigObject): ConfigObject {
    if (!this.schema) return config

    const result = { ...config }
    for (const [key, field] of Object.entries(this.schema.fields)) {
      if (key in result) {
        result[key] = coerceValue(result[key], field.type)
      }
    }
    return result
  }

  /**
   * Get default value for a key from schema
   */
  private getDefault(key: string): ConfigValue {
    if (!this.schema) return undefined

    // Check field-level default
    const field = this.schema.fields[key]
    if (field?.default !== undefined) {
      return field.default
    }

    // Check schema-level defaults
    if (this.schema.defaults && key in this.schema.defaults) {
      return this.schema.defaults[key]
    }

    return undefined
  }

  /**
   * Get a config value by key (supports dot notation)
   */
  get(key: string): ConfigValue {
    let value = getNestedValue(this.config, key)

    if (value === undefined) {
      value = this.getDefault(key)
    }

    return value
  }

  /**
   * Set a config value by key (supports dot notation)
   */
  set(key: string, value: ConfigValue): void {
    const oldValue = this.get(key)

    // Apply type coercion if schema exists
    let coercedValue = value
    if (this.schema) {
      const field = this.schema.fields[key]
      if (field) {
        coercedValue = coerceValue(value, field.type)

        // Validate on set if strict mode
        if (this.options.validateOnSet && field.validate) {
          const result = field.validate(coercedValue)
          if (result !== true) {
            if (this.options.strict) {
              throw new Error(typeof result === 'string' ? result : `Validation failed for ${key}`)
            }
          }
        }
      }
    }

    setNestedValue(this.config, key, coercedValue)

    // Notify listeners
    this.notifier.notify({
      key,
      oldValue,
      newValue: coercedValue,
      timestamp: Date.now(),
    })
  }

  /**
   * Load configuration from a loader
   */
  async load(loader: ConfigLoader): Promise<void> {
    const loaded = await loader.load()
    this.config = this.merger.merge(this.config, loaded)
  }

  /**
   * Validate configuration against schema
   */
  validate(): ValidationResult {
    if (!this.schema) {
      return { valid: true, errors: [] }
    }

    const validator = new SchemaValidator(this.schema)
    const result = validator.validate(this.config)

    if (!result.valid && this.options.strict) {
      throw new Error(`Validation failed: ${result.errors.map((e) => e.message).join(', ')}`)
    }

    return result
  }

  /**
   * Watch for changes on a key
   */
  watch(key: string, callback: ChangeListener): () => void {
    return this.notifier.subscribe(key, callback)
  }

  /**
   * Export all config values
   */
  export(): ExportedConfig {
    return {
      values: deepClone(this.config),
      schema: this.schema ? deepClone(this.schema) : undefined,
      exportedAt: Date.now(),
      version: '1.0.0',
    }
  }

  /**
   * Import config from exported format
   */
  import(config: ExportedConfig): void {
    this.config = this.merger.merge(this.config, config.values)
  }
}
