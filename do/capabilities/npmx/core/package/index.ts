/**
 * Package.json Parsing and Validation
 *
 * Main exports for package.json handling.
 * This module has ZERO Cloudflare dependencies.
 */

// Re-export types
export type {
  PackageJson,
  PackageExports,
  ConditionalExports,
  PersonField,
  RepositoryField,
  BugsField,
  PublishConfig,
  ValidationResult,
  PackageJsonValidationError,
  PackageJsonValidationWarning,
  ErrorCode,
  WarningCode,
  NameValidationResult,
  VersionValidationResult,
  LicenseValidationResult,
  UrlValidationResult,
  HomepageValidationResult,
  ParsedDependency,
  ParsedScript,
  ParsedScripts,
  EntryPointOptions,
  EntryPointResult,
  ParsedFiles,
  ParsedBin,
  ParsedKeywords,
  NormalizedRepository,
  ValidateOptions,
} from './types.js'

// Re-export validation functions
export {
  validatePackageName,
  validateVersion,
  validateLicense,
  validateBugsField,
  validateHomepage,
} from './validate.js'

// Re-export normalization functions
export { normalizeRepository } from './normalize.js'

// Re-export parsing functions
export {
  parseDependencies,
  parseScripts,
  resolveEntryPoint,
  parseFiles,
  parseBin,
  parseKeywords,
} from './parser.js'

import type {
  PackageJson,
  ValidationResult,
  PackageJsonValidationError,
  PackageJsonValidationWarning,
  ValidateOptions,
} from './types.js'
import {
  validatePackageName,
  validateVersion,
  validateLicense,
  validateVersionRange,
} from './validate.js'

// =============================================================================
// Main Parse Function
// =============================================================================

/**
 * Parses a JSON string into a validated PackageJson object.
 *
 * @param json - The JSON string to parse
 * @returns ValidationResult with parsed package and any errors/warnings
 */
export function parsePackageJson(json: string): ValidationResult {
  try {
    const pkg = JSON.parse(json)
    return validatePackageJson(pkg)
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          field: '',
          code: 'JSON_PARSE_ERROR',
          message: e instanceof Error ? e.message : 'Failed to parse JSON',
        },
      ],
      warnings: [],
    }
  }
}

// =============================================================================
// Main Validate Function
// =============================================================================

/**
 * Validates a package.json object.
 *
 * @param pkg - The package object to validate
 * @param options - Validation options
 * @returns ValidationResult with parsed package and any errors/warnings
 */
export function validatePackageJson(
  pkg: unknown,
  options?: ValidateOptions
): ValidationResult {
  const errors: PackageJsonValidationError[] = []
  const warnings: PackageJsonValidationWarning[] = []

  // Must be an object
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return {
      valid: false,
      errors: [
        {
          field: '',
          code: 'JSON_PARSE_ERROR',
          message: 'Package.json must be an object',
        },
      ],
      warnings: [],
    }
  }

  const p = pkg as Record<string, unknown>

  // Validate required fields
  const isPrivate = p.private === true
  const relaxPrivate = options?.relaxPrivate && isPrivate

  // Name validation
  if (p.name === undefined) {
    errors.push({
      field: 'name',
      code: 'REQUIRED_FIELD_MISSING',
      message: 'Package name is required',
    })
  } else if (typeof p.name !== 'string') {
    errors.push({
      field: 'name',
      code: 'INVALID_NAME',
      message: 'Package name must be a string',
    })
  } else if (!relaxPrivate) {
    const nameResult = validatePackageName(p.name)
    if (!nameResult.valid && nameResult.error) {
      errors.push({
        field: 'name',
        code: nameResult.error.code,
        message: nameResult.error.message,
      })
    }
  }

  // Version validation
  if (p.version === undefined) {
    errors.push({
      field: 'version',
      code: 'REQUIRED_FIELD_MISSING',
      message: 'Package version is required',
    })
  } else if (typeof p.version !== 'string') {
    errors.push({
      field: 'version',
      code: 'INVALID_VERSION',
      message: 'Package version must be a string',
    })
  } else {
    const versionResult = validateVersion(p.version)
    if (!versionResult.valid && versionResult.error) {
      errors.push({
        field: 'version',
        code: versionResult.error.code,
        message: versionResult.error.message,
      })
    }
  }

  // Type validation
  if (p.type !== undefined) {
    if (p.type !== 'module' && p.type !== 'commonjs') {
      errors.push({
        field: 'type',
        code: 'INVALID_TYPE',
        message: 'Type must be "module" or "commonjs"',
        value: p.type,
      })
    }
  }

  // Engines validation
  if (p.engines && typeof p.engines === 'object') {
    const engines = p.engines as Record<string, string>
    for (const [engine, range] of Object.entries(engines)) {
      if (typeof range !== 'string') continue
      if (!validateVersionRange(range)) {
        warnings.push({
          field: `engines.${engine}`,
          code: 'INVALID_ENGINE_RANGE',
          message: `Invalid engine range for ${engine}: ${range}`,
        })
      }
    }
  }

  // License validation
  if (p.license !== undefined && typeof p.license === 'string') {
    const licenseResult = validateLicense(p.license)
    if (!licenseResult.valid && licenseResult.error) {
      errors.push({
        field: 'license',
        code: licenseResult.error.code,
        message: licenseResult.error.message,
      })
    } else if (licenseResult.warning) {
      warnings.push({
        field: 'license',
        code: 'DEPRECATED_LICENSE',
        message: licenseResult.warning,
        suggestion: licenseResult.suggestion,
      })
    }
  }

  // Private package with publishConfig warning
  if (isPrivate && p.publishConfig) {
    warnings.push({
      field: 'publishConfig',
      code: 'PUBLISH_CONFIG_ON_PRIVATE',
      message: 'publishConfig is set on a private package',
    })
  }

  // Build parsed result with defaults
  const parsed: PackageJson = {
    name: typeof p.name === 'string' ? p.name : '',
    version: typeof p.version === 'string' ? p.version : '',
    type: p.type === 'module' ? 'module' : 'commonjs',
    private: isPrivate,
    ...p,
  } as PackageJson

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    parsed,
  }
}
