/**
 * Package.json Types and Interfaces
 *
 * Comprehensive type definitions for package.json parsing and validation.
 * This module has ZERO Cloudflare dependencies.
 */

// =============================================================================
// Core Package.json Type
// =============================================================================

export interface PackageJson {
  name: string
  version: string
  description?: string
  main?: string
  module?: string
  types?: string
  typings?: string
  type?: 'module' | 'commonjs'
  exports?: PackageExports
  bin?: Record<string, string> | string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  bundledDependencies?: string[]
  bundleDependencies?: string[]
  engines?: Record<string, string>
  os?: string[]
  cpu?: string[]
  files?: string[]
  keywords?: string[]
  author?: PersonField
  contributors?: PersonField[]
  maintainers?: PersonField[]
  license?: string
  licenses?: Array<{ type: string; url?: string }>
  repository?: RepositoryField
  bugs?: BugsField
  homepage?: string
  private?: boolean
  publishConfig?: PublishConfig
  workspaces?: string[] | { packages: string[] }
  typesVersions?: Record<string, Record<string, string[]>>
  sideEffects?: boolean | string[]
  browser?: string | Record<string, string | false>
  [key: string]: unknown
}

export type PersonField = string | {
  name: string
  email?: string
  url?: string
}

export type RepositoryField = string | {
  type: string
  url: string
  directory?: string
}

export type BugsField = string | {
  url?: string
  email?: string
}

export interface PublishConfig {
  registry?: string
  access?: 'public' | 'restricted'
  tag?: string
  [key: string]: unknown
}

// =============================================================================
// Package Exports Types
// =============================================================================

export type PackageExports =
  | string
  | null
  | ConditionalExports
  | Record<string, string | null | ConditionalExports>

export interface ConditionalExports {
  import?: string | ConditionalExports
  require?: string | ConditionalExports
  node?: string | ConditionalExports
  browser?: string | ConditionalExports
  default?: string | ConditionalExports
  types?: string | ConditionalExports
  [condition: string]: string | null | ConditionalExports | undefined
}

// =============================================================================
// Validation Types
// =============================================================================

export interface ValidationResult {
  valid: boolean
  errors: PackageJsonValidationError[]
  warnings: PackageJsonValidationWarning[]
  parsed?: PackageJson
}

export interface PackageJsonValidationError {
  field: string
  code: ErrorCode
  message: string
  value?: unknown
}

export interface PackageJsonValidationWarning {
  field: string
  code: WarningCode
  message: string
  suggestion?: string
}

export type ErrorCode =
  | 'REQUIRED_FIELD_MISSING'
  | 'INVALID_NAME'
  | 'NAME_MUST_BE_LOWERCASE'
  | 'NAME_CONTAINS_INVALID_CHARS'
  | 'NAME_CANNOT_START_WITH_DOT'
  | 'NAME_CANNOT_START_WITH_UNDERSCORE'
  | 'NAME_TOO_LONG'
  | 'NAME_URL_UNSAFE'
  | 'NAME_BLACKLISTED'
  | 'NAME_CORE_MODULE'
  | 'NAME_INVALID_SCOPE'
  | 'INVALID_VERSION'
  | 'INVALID_SEMVER'
  | 'INVALID_TYPE'
  | 'INVALID_URL'
  | 'INVALID_URL_PROTOCOL'
  | 'INVALID_EMAIL'
  | 'INVALID_SPDX_IDENTIFIER'
  | 'INVALID_SPDX_EXPRESSION'
  | 'INVALID_BIN_NAME'
  | 'INVALID_DEPENDENCY'
  | 'JSON_PARSE_ERROR'

export type WarningCode =
  | 'DEPRECATED_LICENSE'
  | 'INVALID_ENGINE_RANGE'
  | 'KEYWORD_TOO_LONG'
  | 'SUSPICIOUS_INCLUDE_PATTERN'
  | 'MAIN_NOT_INCLUDED'
  | 'BIN_NOT_IN_FILES'
  | 'PUBLISH_CONFIG_ON_PRIVATE'
  | 'DEPRECATED_FIELD'

// =============================================================================
// Name Validation Result
// =============================================================================

export interface NameValidationResult {
  valid: boolean
  error?: {
    code: ErrorCode
    message: string
  }
}

// =============================================================================
// Version Validation Result
// =============================================================================

export interface VersionValidationResult {
  valid: boolean
  error?: {
    code: ErrorCode
    message: string
  }
}

// =============================================================================
// License Validation Result
// =============================================================================

export interface LicenseValidationResult {
  valid: boolean
  spdx?: string
  private?: boolean
  file?: string
  warning?: string
  suggestion?: string
  error?: {
    code: ErrorCode
    message: string
  }
}

// =============================================================================
// URL/Bugs Validation Result
// =============================================================================

export interface UrlValidationResult {
  valid: boolean
  normalized?: BugsField
  error?: {
    code: ErrorCode
    message: string
  }
}

export interface HomepageValidationResult {
  valid: boolean
  error?: {
    code: ErrorCode
    message: string
  }
}

// =============================================================================
// Dependency Types
// =============================================================================

export type DependencyType =
  | 'exact'
  | 'range'
  | 'git'
  | 'github'
  | 'file'
  | 'alias'
  | 'workspace'
  | 'url'
  | 'tag'

export interface ParsedDependency {
  name: string
  version: string
  type: DependencyType
  path?: string
  url?: string
  ref?: string
  realName?: string
  valid?: boolean
  error?: string
}

// =============================================================================
// Scripts Types
// =============================================================================

export interface ParsedScript {
  command: string
  pre?: string
  post?: string
  lifecycle?: boolean
  envVars?: string[]
  references?: string[]
}

export type ParsedScripts = Record<string, ParsedScript>

// =============================================================================
// Entry Point Resolution Types
// =============================================================================

export interface EntryPointOptions {
  type?: 'module' | 'commonjs'
  subpath?: string
  conditions?: string[]
  resolveTypes?: boolean
  tsVersion?: string
}

export interface EntryPointResult {
  entry: string | null
  main?: string
  types?: string
  typesPath?: string
}

// =============================================================================
// Files Parsing Types
// =============================================================================

export interface ParseFilesOptions {
  validate?: boolean
  packageJson?: Partial<PackageJson>
}

export interface ParsedFiles {
  patterns: string[]
  negations: string[]
  alwaysIncluded: string[]
  hasGlobs: boolean
  includeAll: boolean
  warnings?: Array<{ code: WarningCode; message: string; pattern?: string }>
}

// =============================================================================
// Bin Parsing Types
// =============================================================================

export interface ParseBinOptions {
  validate?: boolean
  validatePaths?: boolean
}

export interface ParsedBin extends Record<string, string> {
  warnings?: Array<{ code: WarningCode; message: string; name?: string }>
  errors?: Array<{ code: ErrorCode; message: string; name?: string }>
}

// =============================================================================
// Keywords Parsing Types
// =============================================================================

export interface ParseKeywordsOptions {
  validate?: boolean
}

export interface ParsedKeywords extends Array<string> {
  warnings?: Array<{ code: WarningCode; message: string }>
}

// =============================================================================
// Repository Normalization Types
// =============================================================================

export interface NormalizedRepository {
  type: string
  url: string
  directory?: string
}

// =============================================================================
// Validation Options
// =============================================================================

export interface ValidateOptions {
  relaxPrivate?: boolean
  strict?: boolean
}
