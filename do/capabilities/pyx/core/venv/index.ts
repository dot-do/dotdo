/**
 * Virtual Environment Abstraction for Pyodide
 *
 * This module provides a virtual environment abstraction for managing
 * Python packages in Pyodide environments.
 */

import {
  normalizePackageName,
  isPyodideCompatible as checkPyodideCompatible,
  getPackageDependencies,
  resolveVersion,
} from './compatibility'

import type {
  InstalledPackage,
  VirtualEnvOptions,
  VirtualEnvState,
  InstallOptions,
  ImportOptions,
  ExportOptions,
  ExportedPackage,
} from './types'

// Re-export types for convenience
export type {
  InstalledPackage,
  VirtualEnvOptions,
  VirtualEnvState,
  InstallOptions,
  ImportOptions,
  ExportOptions,
}

/**
 * Generate a unique ID for virtual environments
 */
function generateId(): string {
  return `venv-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Virtual Environment class for managing Python packages
 */
export class VirtualEnv {
  private readonly _id: string
  private readonly _name: string
  private readonly _pythonVersion: string
  private readonly _packages: Map<string, InstalledPackage>
  private readonly _onWarning?: (message: string) => void
  private readonly _strictPyodideCompatibility: boolean

  constructor(options?: VirtualEnvOptions) {
    this._id = generateId()
    this._name = options?.name ?? 'default'
    this._pythonVersion = options?.pythonVersion ?? '3.11'
    this._packages = new Map()
    this._onWarning = options?.onWarning
    this._strictPyodideCompatibility = options?.strictPyodideCompatibility ?? false
  }

  /**
   * Unique identifier for this environment
   */
  get id(): string {
    return this._id
  }

  /**
   * Name of this environment
   */
  get name(): string {
    return this._name
  }

  /**
   * Python version for this environment
   */
  get pythonVersion(): string {
    return this._pythonVersion
  }

  /**
   * Install a package into the virtual environment
   */
  async install(
    pkg: string,
    version?: string,
    options?: InstallOptions
  ): Promise<void> {
    const normalized = normalizePackageName(pkg)

    // Check if already installed
    if (this._packages.has(normalized)) {
      throw new Error(`Package ${normalized} is already installed`)
    }

    // Check wheel compatibility if wheelUrl provided
    if (options?.wheelUrl) {
      const wheelFilename = options.wheelUrl.split('/').pop() || ''
      if (!this.isWheelCompatible(wheelFilename)) {
        throw new Error('Wheel is not compatible with Pyodide')
      }
    }

    // Resolve version
    let resolvedVersion: string | null = null

    if (version) {
      // Parse and resolve version constraint
      resolvedVersion = resolveVersion(normalized, version)
      if (!resolvedVersion) {
        throw new Error(`No compatible version found for ${normalized} with constraint ${version}`)
      }
    } else {
      // Get latest version
      resolvedVersion = resolveVersion(normalized)
      if (!resolvedVersion) {
        // If no known version, use a default
        resolvedVersion = '1.0.0'
      }
    }

    // Check Pyodide compatibility
    const compatible = this.isPyodideCompatible(normalized, resolvedVersion)

    if (!compatible) {
      if (this._strictPyodideCompatibility) {
        throw new Error(`Package ${normalized} is not compatible with Pyodide`)
      }
      if (this._onWarning) {
        this._onWarning(`Package ${normalized} is not compatible with Pyodide`)
      }
    }

    // Determine wheel tag
    let wheelTag = 'py3-none-any'
    if (options?.wheelUrl) {
      const match = options.wheelUrl.match(/-([^-]+-[^-]+-[^-]+)\.whl$/)
      if (match) {
        wheelTag = match[1]
      }
    }

    // Create installed package record
    const installedPkg: InstalledPackage = {
      name: normalized,
      version: resolvedVersion,
      installedAt: new Date(),
      source: options?.source ?? 'pypi',
      wheelTag,
    }

    this._packages.set(normalized, installedPkg)

    // Resolve dependencies if requested
    if (options?.resolveDependencies) {
      await this._installDependencies(normalized, resolvedVersion, new Set([normalized]))
    }
  }

  /**
   * Install dependencies for a package
   */
  private async _installDependencies(
    pkg: string,
    version: string,
    visited: Set<string>
  ): Promise<void> {
    const deps = getPackageDependencies(pkg, version)

    for (const dep of deps) {
      const normalizedDep = normalizePackageName(dep)

      // Skip if already visited (circular dependency handling)
      if (visited.has(normalizedDep)) {
        continue
      }

      visited.add(normalizedDep)

      // Skip if already installed
      if (this._packages.has(normalizedDep)) {
        // Update dependencyOf
        const existing = this._packages.get(normalizedDep)!
        if (!existing.dependencyOf) {
          existing.dependencyOf = []
        }
        if (!existing.dependencyOf.includes(pkg)) {
          existing.dependencyOf.push(pkg)
        }
        continue
      }

      // Get latest version
      const depVersion = resolveVersion(normalizedDep) ?? '1.0.0'

      // Install the dependency
      const installedPkg: InstalledPackage = {
        name: normalizedDep,
        version: depVersion,
        installedAt: new Date(),
        source: 'pypi',
        dependencyOf: [pkg],
        wheelTag: 'py3-none-any',
      }

      this._packages.set(normalizedDep, installedPkg)

      // Recursively install sub-dependencies
      await this._installDependencies(normalizedDep, depVersion, visited)
    }
  }

  /**
   * Uninstall a package from the virtual environment
   */
  async uninstall(pkg: string): Promise<void> {
    const normalized = normalizePackageName(pkg)

    if (!this._packages.has(normalized)) {
      throw new Error(`Package ${normalized} is not installed`)
    }

    // Remove the package
    this._packages.delete(normalized)

    // Note: We don't remove dependencies that might still be needed
    // by other packages. The test expects shared dependencies to remain.
  }

  /**
   * List all installed packages
   */
  list(): InstalledPackage[] {
    return Array.from(this._packages.values())
  }

  /**
   * Check if a package is installed
   */
  isInstalled(pkg: string): boolean {
    const normalized = normalizePackageName(pkg)
    return this._packages.has(normalized)
  }

  /**
   * Get the installed version of a package
   */
  getVersion(pkg: string): string | null {
    const normalized = normalizePackageName(pkg)
    const installed = this._packages.get(normalized)
    return installed?.version ?? null
  }

  /**
   * Check if a package is compatible with Pyodide
   */
  isPyodideCompatible(pkg: string, version?: string): boolean {
    return checkPyodideCompatible(pkg, version)
  }

  /**
   * Check if a wheel file is compatible with Pyodide
   */
  isWheelCompatible(wheelFilename: string): boolean {
    // Extract the wheel tag from filename
    // Format: {distribution}-{version}(-{build tag})?-{python tag}-{abi tag}-{platform tag}.whl

    // Compatible patterns:
    // 1. py3-none-any (pure Python)
    // 2. py2.py3-none-any (pure Python, Python 2/3)
    // 3. emscripten_*_wasm32 (Pyodide-specific)
    // 4. pyodide_*_wasm32 (Pyodide-specific)

    const filename = wheelFilename.toLowerCase()

    // Check for pure Python wheels
    if (filename.includes('-py3-none-any.whl') || filename.includes('-py2.py3-none-any.whl')) {
      return true
    }

    // Check for Pyodide/emscripten wheels
    if (filename.includes('emscripten') && filename.includes('wasm32')) {
      return true
    }

    if (filename.includes('pyodide') && filename.includes('wasm32')) {
      return true
    }

    // Platform-specific wheels are not compatible
    const platformIndicators = [
      'win32',
      'win_amd64',
      'macosx',
      'manylinux',
      'musllinux',
      'linux_x86_64',
      'linux_aarch64',
    ]

    for (const indicator of platformIndicators) {
      if (filename.includes(indicator)) {
        return false
      }
    }

    // If we can't determine, assume not compatible for safety
    return false
  }

  /**
   * Clone this virtual environment
   */
  clone(): VirtualEnv {
    const cloned = new VirtualEnv({
      name: this._name,
      pythonVersion: this._pythonVersion,
      onWarning: this._onWarning,
      strictPyodideCompatibility: this._strictPyodideCompatibility,
    })

    // Deep copy packages
    for (const [name, pkg] of this._packages) {
      cloned._packages.set(name, {
        ...pkg,
        installedAt: new Date(pkg.installedAt),
        dependencyOf: pkg.dependencyOf ? [...pkg.dependencyOf] : undefined,
      })
    }

    return cloned
  }

  /**
   * Export the environment state
   */
  export(options?: ExportOptions): VirtualEnvState | string {
    const format = options?.format ?? 'json'

    if (format === 'requirements') {
      // Export as requirements.txt format
      const lines: string[] = []
      for (const pkg of this._packages.values()) {
        lines.push(`${pkg.name}==${pkg.version}`)
      }
      return lines.join('\n')
    }

    // Export as JSON-serializable state
    const packages: ExportedPackage[] = []
    for (const pkg of this._packages.values()) {
      packages.push({
        name: pkg.name,
        version: pkg.version,
        source: pkg.source,
        installedAt: pkg.installedAt.toISOString(),
        dependencyOf: pkg.dependencyOf,
        wheelTag: pkg.wheelTag,
      })
    }

    return {
      name: this._name,
      pythonVersion: this._pythonVersion,
      packages,
      exportedAt: new Date(),
    }
  }

  /**
   * Import environment state
   */
  async import(
    state: VirtualEnvState | string,
    options?: ImportOptions
  ): Promise<void> {
    const format = options?.format ?? 'json'
    const replace = options?.replace ?? false

    if (replace) {
      this._packages.clear()
    }

    if (format === 'requirements' || typeof state === 'string') {
      // Parse requirements.txt format
      const content = typeof state === 'string' ? state : JSON.stringify(state)
      const lines = content.split('\n')

      for (const line of lines) {
        const trimmed = line.trim()

        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) {
          continue
        }

        // Parse requirement line
        // Format: package==version, package>=version, etc.
        const match = trimmed.match(/^([a-zA-Z0-9_-]+)(([=<>!~]+)(.+))?$/)
        if (match) {
          const pkgName = match[1]
          const versionSpec = match[2] || ''

          // Skip if already installed (unless replace mode)
          if (this.isInstalled(pkgName) && !replace) {
            continue
          }

          await this.install(pkgName, versionSpec || undefined)
        }
      }
    } else {
      // Import from JSON state
      for (const pkg of state.packages) {
        const normalized = normalizePackageName(pkg.name)

        // Skip if already installed (unless replace mode)
        if (this._packages.has(normalized) && !replace) {
          continue
        }

        this._packages.set(normalized, {
          name: normalized,
          version: pkg.version,
          installedAt: new Date(pkg.installedAt),
          source: pkg.source,
          dependencyOf: pkg.dependencyOf,
          wheelTag: pkg.wheelTag,
        })
      }
    }
  }

  /**
   * Create a new VirtualEnv from exported state
   */
  static async fromState(state: VirtualEnvState): Promise<VirtualEnv> {
    const env = new VirtualEnv({
      name: state.name,
      pythonVersion: state.pythonVersion,
    })

    await env.import(state)

    return env
  }
}
