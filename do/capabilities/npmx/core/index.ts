/**
 * @dotdo/npmx - NPM/NPX capabilities for edge runtimes
 *
 * This is the main entry point for the core library.
 * All modules in core/ have ZERO Cloudflare dependencies and can be used
 * in any JavaScript runtime (Node.js, Deno, Bun, browsers, etc.)
 */

// Semver - version range resolution
export * as semver from './semver/index.js'
export type {
  SatisfiesOptions,
  Range,
} from './semver/index.js'

// Resolver - dependency tree resolution from npm registry
export * as resolver from './resolver/index.js'
export type {
  PackageMetadata,
  VersionMetadata,
  ResolveOptions,
  ResolvedPackage,
  DependencyTree,
  DependencyNode,
  ResolutionOptions,
  LockFile,
} from './resolver/index.js'

// Package - package.json handling
export * as pkg from './package/index.js'
export type {
  PackageJson,
  ParseOptions,
  ValidationResult,
} from './package/index.js'

// Tarball - tarball extraction and creation
export * as tarball from './tarball/index.js'
export type {
  ExtractOptions,
  TarEntry,
  TarHeader,
  IntegrityHash,
  CreateOptions,
} from './tarball/index.js'

// Errors - structured error types
export * from './errors/index.js'

// Cache - LRU cache for bounded memory usage
export * as cache from './cache/index.js'
export type {
  CacheOptions,
  CacheStats,
} from './cache/index.js'
export { LRUCache } from './cache/index.js'

// Security - policy-based security controls
export * as security from './security/index.js'
export type {
  NpmSecurityConfig,
  SecurityCheckResult,
  SecurityViolation,
  VulnerabilitySeverity,
  ViolationType,
  VulnerabilityInfo,
  PackageSecurityMetadata,
} from './security/index.js'
export { SecurityPolicy } from './security/index.js'
