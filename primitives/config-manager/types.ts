/**
 * ConfigManager Types
 * Comprehensive configuration management system for the dotdo platform.
 */

/**
 * Supported configuration value types
 */
export type ConfigValue = string | number | boolean | ConfigObject | ConfigArray | null | undefined

/**
 * Configuration object type (nested configs)
 */
export interface ConfigObject {
  [key: string]: ConfigValue
}

/**
 * Configuration array type
 */
export type ConfigArray = ConfigValue[]

/**
 * Field type for schema definitions
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array'

/**
 * Configuration sources
 */
export type ConfigSource = 'env' | 'file' | 'remote' | 'secret'

/**
 * Custom validator function
 */
export type ValidatorFn = (value: ConfigValue) => boolean | string

/**
 * Transform function for value coercion
 */
export type TransformFn = (value: ConfigValue) => ConfigValue

/**
 * Configuration field definition
 */
export interface ConfigField {
  /** Type of the field */
  type: FieldType
  /** Whether the field is required */
  required?: boolean
  /** Default value if not provided */
  default?: ConfigValue
  /** Custom validation function */
  validate?: ValidatorFn
  /** Transform function for value coercion */
  transform?: TransformFn
  /** Description of the field */
  description?: string
  /** Source priority for this field */
  source?: ConfigSource
  /** Environment variable name mapping */
  env?: string
}

/**
 * Configuration schema definition
 */
export interface ConfigSchema {
  /** Schema fields */
  fields: Record<string, ConfigField>
  /** Required fields (alternative to field-level required) */
  required?: string[]
  /** Default values (alternative to field-level defaults) */
  defaults?: ConfigObject
}

/**
 * Validation error detail
 */
export interface ValidationError {
  /** Field path (dot notation for nested) */
  field: string
  /** Error message */
  message: string
  /** Expected type or constraint */
  expected?: string
  /** Actual value received */
  actual?: ConfigValue
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean
  /** List of validation errors */
  errors: ValidationError[]
}

/**
 * Config change event
 */
export interface ConfigChangeEvent {
  /** Key that changed (dot notation for nested) */
  key: string
  /** Previous value */
  oldValue: ConfigValue
  /** New value */
  newValue: ConfigValue
  /** Timestamp of change */
  timestamp: number
  /** Source of the change */
  source?: ConfigSource
}

/**
 * Change listener callback
 */
export type ChangeListener = (event: ConfigChangeEvent) => void

/**
 * Secret provider types
 */
export type SecretProvider = 'do-secrets' | 'kv' | 'env' | 'vault'

/**
 * Secret configuration
 */
export interface SecretConfig {
  /** Secret provider */
  provider: SecretProvider
  /** Secret key/name */
  key: string
  /** Secret version (optional) */
  version?: string
  /** Namespace for the secret */
  namespace?: string
}

/**
 * File loader options
 */
export interface FileLoaderOptions {
  /** File path */
  path: string
  /** File format (auto-detected if not provided) */
  format?: 'json' | 'yaml'
  /** Whether to watch for changes */
  watch?: boolean
}

/**
 * Environment loader options
 */
export interface EnvLoaderOptions {
  /** Prefix for environment variables */
  prefix?: string
  /** Separator for nested keys (default: '__') */
  separator?: string
  /** Whether to convert to lowercase */
  lowercase?: boolean
}

/**
 * Config merge strategy
 */
export type MergeStrategy = 'replace' | 'deep' | 'concat'

/**
 * Config merge options
 */
export interface MergeOptions {
  /** Merge strategy */
  strategy?: MergeStrategy
  /** Whether to clone objects */
  clone?: boolean
}

/**
 * ConfigManager options
 */
export interface ConfigManagerOptions {
  /** Configuration schema */
  schema?: ConfigSchema
  /** Initial configuration values */
  initial?: ConfigObject
  /** Whether to validate on load */
  validateOnLoad?: boolean
  /** Whether to validate on set */
  validateOnSet?: boolean
  /** Strict mode (throw on invalid) */
  strict?: boolean
}

/**
 * Config loader interface
 */
export interface ConfigLoader {
  /** Load configuration from source */
  load(): Promise<ConfigObject>
  /** Source type */
  readonly source: ConfigSource
}

/**
 * Exported config format
 */
export interface ExportedConfig {
  /** Config values */
  values: ConfigObject
  /** Schema if available */
  schema?: ConfigSchema
  /** Export timestamp */
  exportedAt: number
  /** Export version */
  version: string
}
