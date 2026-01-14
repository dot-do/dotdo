/**
 * Type definitions for Python package manifest parsing
 */

// =============================================================================
// Version Specifiers (PEP 440)
// =============================================================================

/**
 * PEP 440 version specifier operators
 */
export type VersionOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | '~=' | '==='

/**
 * A parsed version specifier
 */
export interface VersionSpecifier {
  op: VersionOperator
  version: string
  isWildcard?: boolean
  localVersion?: string
  epoch?: number
}

/**
 * Python version constraint with satisfaction checking
 */
export interface PythonVersionConstraint {
  specifiers: Array<{ op: string; version: string }>
  minVersion?: string
  satisfies(version: string): boolean
}

// =============================================================================
// Requirements
// =============================================================================

/**
 * Base requirement type discriminator
 */
export type RequirementType = 'package' | 'include' | 'constraint' | 'option' | 'editable'

/**
 * A parsed requirement from requirements.txt
 */
export interface Requirement {
  type?: RequirementType
  name?: string
  normalizedName?: string
  specifiers?: Array<{ op: string; version: string }>
  extras?: string[]
  marker?: string
  url?: string
  path?: string
  editable?: boolean
  option?: string
  value?: string
}

// =============================================================================
// pyproject.toml Types (PEP 621)
// =============================================================================

/**
 * Author/maintainer information
 */
export interface PersonInfo {
  name?: string
  email?: string
}

/**
 * License information
 */
export interface LicenseInfo {
  text?: string
  file?: string
}

/**
 * [project] section of pyproject.toml
 */
export interface ProjectSection {
  name?: string
  version?: string
  description?: string
  readme?: string | { file?: string; text?: string; contentType?: string }
  license?: LicenseInfo
  authors?: PersonInfo[]
  maintainers?: PersonInfo[]
  keywords?: string[]
  classifiers?: string[]
  urls?: Record<string, string>
  scripts?: Record<string, string>
  guiScripts?: Record<string, string>
  entryPoints?: Record<string, Record<string, string>>
  dependencies?: string[]
  optionalDependencies?: Record<string, string[]>
  requiresPython?: string
  dynamic?: string[]
}

/**
 * [build-system] section of pyproject.toml
 */
export interface BuildSystemSection {
  requires?: string[]
  buildBackend?: string
  backendPath?: string[]
}

/**
 * Full parsed pyproject.toml
 */
export interface PyprojectToml {
  project?: ProjectSection
  buildSystem?: BuildSystemSection
  tool?: Record<string, unknown>
}

// =============================================================================
// Package Metadata
// =============================================================================

/**
 * Unified package metadata extracted from various sources
 */
export interface PackageMetadata {
  name?: string
  normalizedName?: string
  version?: string
  description?: string
  requiresPython?: string
  dependencies?: string[]
  parsedDependencies?: Requirement[]
  optionalDependencies?: Record<string, string[]>
  entryPoints?: {
    console_scripts?: string[]
    gui_scripts?: string[]
    [key: string]: string[] | undefined
  }
  source?: 'pyproject.toml' | 'setup.py' | 'setup.cfg'
}

/**
 * Parsed dependency with full details
 */
export interface ParsedDependency {
  name: string
  normalizedName: string
  specifiers: Array<{ op: string; version: string }>
  extras?: string[]
  marker?: string
  url?: string
}
