/**
 * Types for Virtual Environment Abstraction
 *
 * InstalledPackage, VirtualEnvState, and related types for
 * managing Python packages in Pyodide environments.
 */

/**
 * Represents an installed Python package
 */
export interface InstalledPackage {
  /** Package name (normalized to lowercase) */
  name: string
  /** Installed version */
  version: string
  /** When the package was installed */
  installedAt: Date
  /** Source of the package (pypi, local, etc.) */
  source: string
  /** Packages that depend on this one */
  dependencyOf?: string[]
  /** Wheel tag (e.g., 'py3-none-any') */
  wheelTag?: string
}

/**
 * Options for creating a VirtualEnv
 */
export interface VirtualEnvOptions {
  /** Name of the virtual environment */
  name?: string
  /** Python version to target */
  pythonVersion?: string
  /** Callback for warnings */
  onWarning?: (message: string) => void
  /** If true, reject packages not compatible with Pyodide */
  strictPyodideCompatibility?: boolean
}

/**
 * Serializable state of a VirtualEnv
 */
export interface VirtualEnvState {
  /** Environment name */
  name: string
  /** Python version */
  pythonVersion?: string
  /** List of installed packages */
  packages: ExportedPackage[]
  /** When the state was exported */
  exportedAt: Date
}

/**
 * Package data in exported state (serializable)
 */
export interface ExportedPackage {
  name: string
  version: string
  source: string
  installedAt: string // ISO date string for serialization
  dependencyOf?: string[]
  wheelTag?: string
}

/**
 * Options for installing a package
 */
export interface InstallOptions {
  /** Source of the package (default: 'pypi') */
  source?: string
  /** Whether to resolve and install dependencies */
  resolveDependencies?: boolean
  /** URL to wheel file */
  wheelUrl?: string
}

/**
 * Options for importing environment state
 */
export interface ImportOptions {
  /** Format of the state (default: 'json') */
  format?: 'json' | 'requirements'
  /** If true, replace all existing packages */
  replace?: boolean
}

/**
 * Options for exporting environment state
 */
export interface ExportOptions {
  /** Format of the export (default: 'json') */
  format?: 'json' | 'requirements'
}

/**
 * Information about a Pyodide-compatible package
 */
export interface PyodidePackageInfo {
  /** Minimum supported version */
  minVersion?: string
  /** Maximum supported version */
  maxVersion?: string
  /** Whether it's a pure Python package */
  purePython?: boolean
  /** Known dependencies in Pyodide */
  dependencies?: string[]
}

/**
 * Parsed version constraint
 */
export interface VersionConstraint {
  operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | '~=' | '==='
  version: string
}
