/**
 * Package.json Validation Functions
 *
 * Validators for package names, versions, licenses, URLs, and other fields.
 * This module has ZERO Cloudflare dependencies.
 */

import type {
  NameValidationResult,
  VersionValidationResult,
  LicenseValidationResult,
  UrlValidationResult,
  HomepageValidationResult,
  BugsField,
} from './types.js'

// =============================================================================
// Constants
// =============================================================================

/**
 * Node.js core modules that cannot be used as package names
 */
const CORE_MODULES = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster',
  'console', 'constants', 'crypto', 'dgram', 'diagnostics_channel',
  'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https',
  'inspector', 'module', 'net', 'os', 'path', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'repl',
  'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events',
  'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
])

/**
 * Blacklisted package names
 */
const BLACKLISTED_NAMES = new Set([
  'node_modules',
  'favicon.ico',
])

/**
 * Valid SPDX license identifiers (common ones)
 */
const SPDX_LICENSES: Record<string, string> = {
  'mit': 'MIT',
  'isc': 'ISC',
  'bsd-2-clause': 'BSD-2-Clause',
  'bsd-3-clause': 'BSD-3-Clause',
  'apache-2.0': 'Apache-2.0',
  'mpl-2.0': 'MPL-2.0',
  'lgpl-2.1-only': 'LGPL-2.1-only',
  'lgpl-2.1-or-later': 'LGPL-2.1-or-later',
  'lgpl-3.0-only': 'LGPL-3.0-only',
  'lgpl-3.0-or-later': 'LGPL-3.0-or-later',
  'gpl-2.0-only': 'GPL-2.0-only',
  'gpl-2.0-or-later': 'GPL-2.0-or-later',
  'gpl-3.0-only': 'GPL-3.0-only',
  'gpl-3.0-or-later': 'GPL-3.0-or-later',
  'agpl-3.0-only': 'AGPL-3.0-only',
  'agpl-3.0-or-later': 'AGPL-3.0-or-later',
  'unlicense': 'Unlicense',
  'wtfpl': 'WTFPL',
  'cc0-1.0': 'CC0-1.0',
  'cc-by-4.0': 'CC-BY-4.0',
  'cc-by-sa-4.0': 'CC-BY-SA-4.0',
  '0bsd': '0BSD',
  'artistic-2.0': 'Artistic-2.0',
  'zlib': 'Zlib',
  'unlicensed': 'UNLICENSED',
}

/**
 * Deprecated SPDX identifiers and their replacements
 */
const DEPRECATED_LICENSES: Record<string, string> = {
  'gpl-2.0': 'GPL-2.0-only',
  'gpl-3.0': 'GPL-3.0-only',
  'lgpl-2.1': 'LGPL-2.1-only',
  'lgpl-3.0': 'LGPL-3.0-only',
  'agpl-3.0': 'AGPL-3.0-only',
}

/**
 * SPDX exception identifiers
 */
const SPDX_EXCEPTIONS = new Set([
  'Classpath-exception-2.0',
  'LLVM-exception',
  'GPL-3.0-linking-exception',
])

// =============================================================================
// Name Validation
// =============================================================================

/**
 * Validates an npm package name according to npm naming rules.
 *
 * Rules:
 * - Must be lowercase
 * - Cannot start with . or _
 * - Cannot contain spaces or special characters
 * - Must be URL-safe
 * - Cannot be a Node.js core module name
 * - Cannot be a blacklisted name
 * - Maximum 214 characters
 */
export function validatePackageName(name: string): NameValidationResult {
  // Check for empty name
  if (!name || name.length === 0) {
    return {
      valid: false,
      error: {
        code: 'INVALID_NAME',
        message: 'Package name cannot be empty',
      },
    }
  }

  // Check length
  if (name.length > 214) {
    return {
      valid: false,
      error: {
        code: 'NAME_TOO_LONG',
        message: `Package name cannot exceed 214 characters (got ${name.length})`,
      },
    }
  }

  // Handle scoped packages
  if (name.startsWith('@')) {
    return validateScopedPackageName(name)
  }

  // Check for starting with dot
  if (name.startsWith('.')) {
    return {
      valid: false,
      error: {
        code: 'NAME_CANNOT_START_WITH_DOT',
        message: 'Package name cannot start with a dot',
      },
    }
  }

  // Check for starting with underscore
  if (name.startsWith('_')) {
    return {
      valid: false,
      error: {
        code: 'NAME_CANNOT_START_WITH_UNDERSCORE',
        message: 'Package name cannot start with an underscore',
      },
    }
  }

  // Check for uppercase
  if (name !== name.toLowerCase()) {
    return {
      valid: false,
      error: {
        code: 'NAME_MUST_BE_LOWERCASE',
        message: 'Package name must be lowercase',
      },
    }
  }

  // Check for spaces and invalid characters
  if (/\s/.test(name)) {
    return {
      valid: false,
      error: {
        code: 'NAME_CONTAINS_INVALID_CHARS',
        message: 'Package name cannot contain spaces',
      },
    }
  }

  // Check URL safety (no slashes for non-scoped packages)
  // Check this BEFORE the general invalid chars check so we get the right error code
  if (name.includes('/')) {
    return {
      valid: false,
      error: {
        code: 'NAME_URL_UNSAFE',
        message: 'Package name contains URL-unsafe characters',
      },
    }
  }

  // Check for special characters (allow a-z, 0-9, -, _, .)
  if (!/^[a-z0-9._-]+$/.test(name)) {
    return {
      valid: false,
      error: {
        code: 'NAME_CONTAINS_INVALID_CHARS',
        message: 'Package name contains invalid characters',
      },
    }
  }

  // Check blacklist
  if (BLACKLISTED_NAMES.has(name)) {
    return {
      valid: false,
      error: {
        code: 'NAME_BLACKLISTED',
        message: `Package name "${name}" is blacklisted`,
      },
    }
  }

  // Check core modules
  if (CORE_MODULES.has(name)) {
    return {
      valid: false,
      error: {
        code: 'NAME_CORE_MODULE',
        message: `Package name "${name}" is a Node.js core module`,
      },
    }
  }

  return { valid: true }
}

/**
 * Validates a scoped package name (@scope/name)
 */
function validateScopedPackageName(name: string): NameValidationResult {
  const slashIndex = name.indexOf('/')

  // Must have exactly one slash
  if (slashIndex === -1) {
    return {
      valid: false,
      error: {
        code: 'NAME_INVALID_SCOPE',
        message: 'Scoped package must have format @scope/name',
      },
    }
  }

  const scope = name.slice(1, slashIndex)
  const packageName = name.slice(slashIndex + 1)

  // Check for empty scope
  if (scope.length === 0) {
    return {
      valid: false,
      error: {
        code: 'NAME_INVALID_SCOPE',
        message: 'Scope cannot be empty',
      },
    }
  }

  // Check for empty package name
  if (packageName.length === 0) {
    return {
      valid: false,
      error: {
        code: 'NAME_INVALID_SCOPE',
        message: 'Package name after scope cannot be empty',
      },
    }
  }

  // Scope must be lowercase
  if (scope !== scope.toLowerCase()) {
    return {
      valid: false,
      error: {
        code: 'NAME_INVALID_SCOPE',
        message: 'Scope must be lowercase',
      },
    }
  }

  // Package name must be lowercase
  if (packageName !== packageName.toLowerCase()) {
    return {
      valid: false,
      error: {
        code: 'NAME_MUST_BE_LOWERCASE',
        message: 'Package name must be lowercase',
      },
    }
  }

  // Check scope for valid characters
  if (!/^[a-z0-9._-]+$/.test(scope)) {
    return {
      valid: false,
      error: {
        code: 'NAME_INVALID_SCOPE',
        message: 'Scope contains invalid characters',
      },
    }
  }

  // Check package name for valid characters
  if (!/^[a-z0-9._-]+$/.test(packageName)) {
    return {
      valid: false,
      error: {
        code: 'NAME_CONTAINS_INVALID_CHARS',
        message: 'Package name contains invalid characters',
      },
    }
  }

  return { valid: true }
}

// =============================================================================
// Version Validation
// =============================================================================

/**
 * Semver regex pattern
 * Matches: MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
 */
const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/**
 * Validates a version string according to semver 2.0.0.
 */
export function validateVersion(version: string): VersionValidationResult {
  if (!version || version.length === 0) {
    return {
      valid: false,
      error: {
        code: 'INVALID_VERSION',
        message: 'Version cannot be empty',
      },
    }
  }

  // Check for v prefix (not valid in strict semver)
  if (version.startsWith('v') || version.startsWith('V')) {
    return {
      valid: false,
      error: {
        code: 'INVALID_SEMVER',
        message: 'Version cannot have a "v" prefix',
      },
    }
  }

  // Check for negative numbers
  if (version.includes('-') && /^-\d/.test(version)) {
    return {
      valid: false,
      error: {
        code: 'INVALID_SEMVER',
        message: 'Version numbers cannot be negative',
      },
    }
  }

  // Match against semver regex
  if (!SEMVER_REGEX.test(version)) {
    return {
      valid: false,
      error: {
        code: 'INVALID_SEMVER',
        message: 'Version must be a valid semver string (MAJOR.MINOR.PATCH)',
      },
    }
  }

  return { valid: true }
}

/**
 * Validates a version range (for engines, dependencies)
 */
export function validateVersionRange(range: string): boolean {
  if (!range || range.length === 0) return false

  // Simple patterns that are valid
  const simplePatterns = [
    /^[*x]$/,                              // * or x
    /^>=?\d+(\.\d+)?(\.\d+)?$/,           // >=1, >=1.0, >=1.0.0
    /^<=?\d+(\.\d+)?(\.\d+)?$/,           // <=1, <=1.0, <=1.0.0
    /^\^?\d+(\.\d+)?(\.\d+)?$/,           // ^1, ^1.0, ^1.0.0
    /^~?\d+(\.\d+)?(\.\d+)?$/,            // ~1, ~1.0, ~1.0.0
    /^\d+(\.\d+)?(\.\d+)?$/,              // 1, 1.0, 1.0.0
    /^\d+(\.\d+)?(\.\d+)?-\d+(\.\d+)?(\.\d+)?$/, // 1.0.0-2.0.0
  ]

  // Check if it matches any simple pattern
  for (const pattern of simplePatterns) {
    if (pattern.test(range)) return true
  }

  // Check for compound ranges (space-separated or ||)
  const parts = range.split(/\s+\|\|\s+|\s+/)
  return parts.every(part => {
    // Each part should match a simple range pattern
    return simplePatterns.some(pattern => pattern.test(part))
  })
}

// =============================================================================
// License Validation
// =============================================================================

/**
 * Validates a license field according to SPDX specification.
 */
export function validateLicense(license: string): LicenseValidationResult {
  if (!license || license.length === 0) {
    return {
      valid: false,
      error: {
        code: 'INVALID_SPDX_IDENTIFIER',
        message: 'License cannot be empty',
      },
    }
  }

  // Handle UNLICENSED
  if (license.toUpperCase() === 'UNLICENSED') {
    return {
      valid: true,
      spdx: 'UNLICENSED',
      private: true,
    }
  }

  // Handle SEE LICENSE IN <filename>
  const seeLicenseMatch = license.match(/^SEE LICENSE IN (.+)$/i)
  if (seeLicenseMatch) {
    return {
      valid: true,
      file: seeLicenseMatch[1],
    }
  }

  // Handle parenthesized expression - check this BEFORE single identifier
  if (license.startsWith('(') && license.endsWith(')')) {
    const inner = license.slice(1, -1)
    // Check if inner contains operators
    if (/ OR | AND | WITH /i.test(inner)) {
      return validateSpdxExpression(inner)
    }
  }

  // Check for SPDX expression operators
  if (/ OR | AND | WITH /i.test(license)) {
    return validateSpdxExpression(license)
  }

  // Single license identifier
  const normalized = license.toLowerCase()

  // Check deprecated licenses
  if (DEPRECATED_LICENSES[normalized]) {
    return {
      valid: true,
      spdx: DEPRECATED_LICENSES[normalized],
      warning: `License "${license}" is deprecated`,
      suggestion: DEPRECATED_LICENSES[normalized],
    }
  }

  // Check valid licenses
  if (SPDX_LICENSES[normalized]) {
    return {
      valid: true,
      spdx: SPDX_LICENSES[normalized],
    }
  }

  // Unknown license
  return {
    valid: false,
    error: {
      code: 'INVALID_SPDX_IDENTIFIER',
      message: `Unknown SPDX license identifier: ${license}`,
    },
  }
}

/**
 * Validates an SPDX expression (e.g., "MIT OR Apache-2.0")
 */
function validateSpdxExpression(expression: string): LicenseValidationResult {
  // Tokenize the expression
  const tokens = expression.trim().split(/\s+/)

  if (tokens.length === 0) {
    return {
      valid: false,
      error: {
        code: 'INVALID_SPDX_EXPRESSION',
        message: 'Empty SPDX expression',
      },
    }
  }

  // Must start with a license, not an operator
  if (['OR', 'AND', 'WITH'].includes(tokens[0]?.toUpperCase() ?? '')) {
    return {
      valid: false,
      error: {
        code: 'INVALID_SPDX_EXPRESSION',
        message: 'SPDX expression cannot start with an operator',
      },
    }
  }

  // Must end with a license or exception, not an operator
  const lastToken = tokens[tokens.length - 1]
  if (['OR', 'AND', 'WITH'].includes(lastToken?.toUpperCase() ?? '')) {
    return {
      valid: false,
      error: {
        code: 'INVALID_SPDX_EXPRESSION',
        message: 'SPDX expression cannot end with an operator',
      },
    }
  }

  // Validate each token
  let expectingOperator = false
  let expectingException = false

  for (const token of tokens) {
    const upper = token.toUpperCase()

    if (expectingException) {
      // After WITH, expect an exception
      if (!SPDX_EXCEPTIONS.has(token)) {
        // Still valid, might be a custom exception
        expectingException = false
        expectingOperator = true
        continue
      }
      expectingException = false
      expectingOperator = true
      continue
    }

    if (expectingOperator) {
      if (upper === 'OR' || upper === 'AND') {
        expectingOperator = false
        continue
      } else if (upper === 'WITH') {
        expectingOperator = false
        expectingException = true
        continue
      } else {
        return {
          valid: false,
          error: {
            code: 'INVALID_SPDX_EXPRESSION',
            message: `Expected operator, got "${token}"`,
          },
        }
      }
    } else {
      // Expecting a license
      const normalized = token.toLowerCase()
      if (!SPDX_LICENSES[normalized] && !DEPRECATED_LICENSES[normalized]) {
        return {
          valid: false,
          error: {
            code: 'INVALID_SPDX_IDENTIFIER',
            message: `Unknown SPDX license identifier: ${token}`,
          },
        }
      }
      expectingOperator = true
    }
  }

  return { valid: true }
}

// =============================================================================
// URL Validation
// =============================================================================

/**
 * Validates and normalizes the bugs field.
 */
export function validateBugsField(bugs: BugsField | undefined): UrlValidationResult {
  if (bugs === undefined) {
    return { valid: true }
  }

  // String URL
  if (typeof bugs === 'string') {
    const urlResult = validateUrl(bugs)
    if (!urlResult.valid) {
      return urlResult
    }
    return {
      valid: true,
      normalized: { url: bugs },
    }
  }

  // Object with url and/or email
  if (typeof bugs === 'object') {
    if (bugs.url) {
      const urlResult = validateUrl(bugs.url)
      if (!urlResult.valid) {
        return urlResult
      }
    }

    if (bugs.email) {
      const emailResult = validateEmail(bugs.email)
      if (!emailResult.valid) {
        return {
          valid: false,
          error: {
            code: 'INVALID_EMAIL',
            message: `Invalid email: ${bugs.email}`,
          },
        }
      }
    }

    return { valid: true, normalized: bugs }
  }

  return {
    valid: false,
    error: {
      code: 'INVALID_URL',
      message: 'Bugs field must be a string URL or object with url/email',
    },
  }
}

/**
 * Validates the homepage field.
 */
export function validateHomepage(homepage: string | undefined): HomepageValidationResult {
  if (homepage === undefined) {
    return { valid: true }
  }

  // Must be a valid URL
  const urlResult = validateUrl(homepage)
  if (!urlResult.valid) {
    return {
      valid: false,
      error: urlResult.error,
    }
  }

  // Must be http or https
  try {
    const url = new URL(homepage)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        valid: false,
        error: {
          code: 'INVALID_URL_PROTOCOL',
          message: 'Homepage URL must use http or https protocol',
        },
      }
    }
  } catch {
    return {
      valid: false,
      error: {
        code: 'INVALID_URL',
        message: 'Invalid homepage URL',
      },
    }
  }

  return { valid: true }
}

/**
 * Validates a URL string.
 */
function validateUrl(url: string): UrlValidationResult {
  try {
    new URL(url)
    return { valid: true }
  } catch {
    return {
      valid: false,
      error: {
        code: 'INVALID_URL',
        message: `Invalid URL: ${url}`,
      },
    }
  }
}

/**
 * Validates an email address.
 */
function validateEmail(email: string): { valid: boolean } {
  // Simple email regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return { valid: emailRegex.test(email) }
}
