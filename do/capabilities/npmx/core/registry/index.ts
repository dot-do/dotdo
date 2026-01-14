/**
 * npm Registry Client
 *
 * Fetch-based HTTP client for npm registries.
 *
 * @module core/registry
 */

export { RegistryClient, type RegistryClientOptions } from './client.js'

// Binary resolution
export {
  resolveBinaryPath,
  resolveBinaries,
  type BinaryResolutionResult,
  type BinaryEntry,
  type ResolveBinaryOptions,
  type PackageJsonForBin,
} from './binary-resolution.js'
