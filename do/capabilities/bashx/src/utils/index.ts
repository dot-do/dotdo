/**
 * Utility Functions
 *
 * Cross-platform utilities for bashx.do
 *
 * @packageDocumentation
 */

export {
  // Path conversion functions
  toUnixPath,
  toWindowsPath,
  resolvePath,
  expandPath,
  normalizePath,

  // Path detection functions
  isAbsolutePath,
  detectPlatform,
  PathPlatform,

  // Security validation
  validatePathSecurity,
  PathSecurityError,

  // Cache management
  clearPathCache,

  // Types
  type PathSecurityOptions,
  type SecurityViolationType,
} from './path-normalizer.js'
