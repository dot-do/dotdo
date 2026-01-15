/**
 * Input validation utilities for paths and URLs
 *
 * Provides security-focused validation and sanitization for user-provided
 * paths and URLs to prevent:
 * - Path traversal attacks
 * - Null byte injection
 * - Protocol handler abuse
 * - SSRF (Server-Side Request Forgery)
 * - Open redirect vulnerabilities
 *
 * @module lib/validation
 */

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface PathValidationOptions {
  /** Allow absolute paths (default: false) */
  allowAbsolute?: boolean
}

export interface UrlValidationOptions {
  /** Allowed protocols (default: ['http:', 'https:']) */
  allowedProtocols?: string[]
  /** Block internal/private IP addresses for SSRF prevention */
  blockInternalIPs?: boolean
  /** Restrict URLs to specific domains (with subdomain matching) */
  allowedDomains?: string[]
}

// Control characters (0x00-0x1F except tab 0x09) and DEL (0x7F)
// Includes CR (0x0D), LF (0x0A), and other dangerous control chars
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0A-\x1F\x7F]/

// Null byte patterns (literal and encoded)
const NULL_BYTE_REGEX = /\x00|%00/i

// Path traversal patterns
const PATH_TRAVERSAL_PATTERNS = [
  /\.\./,                    // literal ..
  /%2e%2e/i,                 // URL encoded ..
  /%252e%252e/i,             // double URL encoded ..
  /\u002e\u002e/,            // unicode dots
]

// Windows path traversal
const WINDOWS_TRAVERSAL_REGEX = /\.\.\\/

// Absolute path patterns
const UNIX_ABSOLUTE_REGEX = /^[/]/
const WINDOWS_ABSOLUTE_REGEX = /^[a-zA-Z]:[\\\/]/

// Dangerous URL protocols
const DANGEROUS_PROTOCOLS = new Set([
  'javascript:',
  'data:',
  'file:',
  'vbscript:',
  'ftp:',
])

// Internal IP ranges for SSRF prevention
const INTERNAL_IP_PATTERNS = [
  /^127\./,                          // Loopback
  /^10\./,                           // Class A private
  /^192\.168\./,                     // Class C private
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // Class B private
  /^169\.254\./,                     // Link-local
  /^0\./,                            // Current network
  /^::1$/,                           // IPv6 loopback
  /^fc00:/i,                         // IPv6 unique local
  /^fe80:/i,                         // IPv6 link-local
]

/**
 * Validate a file path for security issues
 *
 * Checks for:
 * - Path traversal attempts (..)
 * - Null bytes
 * - Control characters
 * - Absolute paths (unless explicitly allowed)
 *
 * @param path - The path to validate
 * @param options - Validation options
 * @returns Validation result with error message if invalid
 *
 * @example
 * ```typescript
 * const result = validatePath(userInput)
 * if (!result.valid) {
 *   throw new Error(result.error)
 * }
 * ```
 */
export function validatePath(path: string, options: PathValidationOptions = {}): ValidationResult {
  const { allowAbsolute = false } = options

  // Check for null bytes
  if (NULL_BYTE_REGEX.test(path)) {
    return { valid: false, error: 'Path contains null bytes' }
  }

  // Check for control characters
  if (CONTROL_CHAR_REGEX.test(path)) {
    return { valid: false, error: 'Path contains control characters' }
  }

  // Check for path traversal patterns
  for (const pattern of PATH_TRAVERSAL_PATTERNS) {
    if (pattern.test(path)) {
      return { valid: false, error: 'Path traversal not allowed' }
    }
  }

  // Check for Windows-style traversal
  if (WINDOWS_TRAVERSAL_REGEX.test(path)) {
    return { valid: false, error: 'Path traversal not allowed' }
  }

  // Check for absolute paths
  if (!allowAbsolute && isAbsolutePath(path)) {
    return { valid: false, error: 'Absolute paths not allowed' }
  }

  return { valid: true }
}

/**
 * Check if a path is absolute (Unix or Windows style)
 *
 * @param path - The path to check
 * @returns True if the path is absolute
 */
export function isAbsolutePath(path: string): boolean {
  return UNIX_ABSOLUTE_REGEX.test(path) || WINDOWS_ABSOLUTE_REGEX.test(path)
}

/**
 * Sanitize a path by removing dangerous elements
 *
 * Removes:
 * - Path traversal sequences (..)
 * - Null bytes
 * - Control characters
 * - Multiple consecutive slashes
 *
 * Note: This is a "best effort" sanitization. When security is critical,
 * use validatePath() to reject invalid input instead.
 *
 * @param path - The path to sanitize
 * @returns The sanitized path
 */
export function sanitizePath(path: string): string {
  let sanitized = path

  // Remove null bytes
  sanitized = sanitized.replace(/\x00/g, '')
  sanitized = sanitized.replace(/%00/gi, '')

  // Remove control characters (use global flag)
  sanitized = sanitized.replace(/[\x00-\x08\x0A-\x1F\x7F]/g, '')

  // Remove path traversal sequences (both forward and backslash)
  sanitized = sanitized.replace(/\.\.[\\/]/g, '')
  sanitized = sanitized.replace(/%2e%2e[\\/]/gi, '')
  sanitized = sanitized.replace(/%252e%252e[\\/]/gi, '')

  // Normalize multiple slashes to single
  sanitized = sanitized.replace(/\/+/g, '/')
  sanitized = sanitized.replace(/\\+/g, '\\')

  // Remove leading slashes to prevent absolute paths
  sanitized = sanitized.replace(/^[\/\\]+/, '')

  return sanitized
}

/**
 * Normalize path segments, resolving relative references safely
 *
 * Unlike path.normalize(), this prevents escaping the base directory
 * by discarding any .. that would go above the root.
 *
 * @param segments - Array of path segments
 * @returns Normalized array of segments
 */
export function normalizePathSegments(segments: string[]): string[] {
  const result: string[] = []

  for (const segment of segments) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      // Don't allow going above root - just pop if we can
      if (result.length > 0) {
        result.pop()
      }
      // If empty, we're at root - discard the ..
      continue
    }
    result.push(segment)
  }

  return result
}

/**
 * Validate a URL for security issues
 *
 * Checks for:
 * - Valid URL format
 * - Allowed protocols (default: http/https only)
 * - Path traversal in URL path
 * - Optional: Internal IP blocking for SSRF prevention
 * - Optional: Domain allowlist
 *
 * @param url - The URL to validate
 * @param options - Validation options
 * @returns Validation result with error message if invalid
 */
export function validateUrl(url: string, options: UrlValidationOptions = {}): ValidationResult {
  const { allowedProtocols = ['http:', 'https:'], blockInternalIPs = false, allowedDomains } = options

  // Try to parse the URL
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }

  // Validate protocol
  const protocol = parsed.protocol.toLowerCase()
  if (DANGEROUS_PROTOCOLS.has(protocol)) {
    return { valid: false, error: `Dangerous protocol not allowed: ${protocol}` }
  }

  if (!allowedProtocols.includes(protocol)) {
    return { valid: false, error: `Protocol not allowed: ${protocol}` }
  }

  // Check for empty hostname
  if (!parsed.hostname) {
    return { valid: false, error: 'Invalid URL format: missing hostname' }
  }

  // Check for unencoded spaces in original URL (URL API auto-encodes them)
  if (url.includes(' ')) {
    return { valid: false, error: 'Invalid URL format: contains unencoded spaces' }
  }

  // Check for path traversal in the original URL (before URL API normalizes it)
  // The URL API resolves '../' patterns, so we need to check the original string
  const pathPart = url.substring(url.indexOf('://') + 3)
  if (pathPart.includes('..') || pathPart.includes('%2e%2e') || pathPart.includes('%2E%2E')) {
    return { valid: false, error: 'Path traversal not allowed in URL' }
  }

  // Optional: Block internal IPs for SSRF prevention
  if (blockInternalIPs) {
    const hostname = parsed.hostname.toLowerCase()

    // Check for localhost
    if (hostname === 'localhost' || hostname === 'localhost.localdomain') {
      return { valid: false, error: 'Internal hostname not allowed' }
    }

    // Check for internal IP patterns
    for (const pattern of INTERNAL_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return { valid: false, error: 'Internal IP address not allowed' }
      }
    }
  }

  // Optional: Validate against domain allowlist
  if (allowedDomains && allowedDomains.length > 0) {
    const hostname = parsed.hostname.toLowerCase()

    const isAllowed = allowedDomains.some((domain) => {
      const domainLower = domain.toLowerCase()
      // Exact match or subdomain match
      return hostname === domainLower || hostname.endsWith('.' + domainLower)
    })

    if (!isAllowed) {
      return { valid: false, error: `Domain not in allowlist: ${hostname}` }
    }
  }

  return { valid: true }
}

/**
 * Sanitize a URL by normalizing and removing dangerous elements
 *
 * - Removes credentials (user:pass)
 * - Normalizes protocol and hostname to lowercase
 * - Removes default ports (80 for http, 443 for https)
 * - Returns empty string for dangerous protocols
 *
 * @param url - The URL to sanitize
 * @returns The sanitized URL, or empty string if dangerous
 */
export function sanitizeUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return ''
  }

  const protocol = parsed.protocol.toLowerCase()

  // Return empty for dangerous protocols
  if (DANGEROUS_PROTOCOLS.has(protocol)) {
    return ''
  }

  // Normalize protocol and hostname
  parsed.protocol = protocol
  parsed.hostname = parsed.hostname.toLowerCase()

  // Remove credentials
  parsed.username = ''
  parsed.password = ''

  // Remove default ports
  if ((protocol === 'http:' && parsed.port === '80') || (protocol === 'https:' && parsed.port === '443')) {
    parsed.port = ''
  }

  return parsed.toString()
}

/**
 * Validate a callback/redirect URL to prevent open redirects
 *
 * This is a convenience wrapper around validateUrl with domain allowlist.
 *
 * @param url - The redirect URL to validate
 * @param allowedDomains - List of allowed domains
 * @returns Validation result
 */
export function validateRedirectUrl(url: string, allowedDomains: string[]): ValidationResult {
  return validateUrl(url, { allowedDomains })
}

/**
 * Validate a webhook URL with SSRF protection
 *
 * This is a convenience wrapper around validateUrl with internal IP blocking.
 *
 * @param url - The webhook URL to validate
 * @returns Validation result
 */
export function validateWebhookUrl(url: string): ValidationResult {
  return validateUrl(url, { blockInternalIPs: true })
}
