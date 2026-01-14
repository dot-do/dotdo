/**
 * Package Binary Resolution
 *
 * Resolves executable binaries from npm packages.
 * Handles:
 * - bin field as string (single binary, uses package name)
 * - bin field as object (multiple named binaries)
 * - directories.bin field (directory containing executables)
 *
 * @module npmx/core/registry/binary-resolution
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of binary resolution
 */
export interface BinaryResolutionResult {
  /** Whether a binary was found */
  found: boolean
  /** Binary command name */
  name?: string
  /** Path to the binary entry point */
  path?: string
  /** Package that provides this binary */
  package?: string
  /** Error message if not found */
  error?: string
  /** Whether the package has any binaries */
  hasBinaries?: boolean
  /** List of available binary names (when specific one not found) */
  availableBinaries?: string[]
}

/**
 * A single binary entry
 */
export interface BinaryEntry {
  /** Binary command name */
  name: string
  /** Path to the binary file */
  path: string
}

/**
 * Options for binary resolution
 */
export interface ResolveBinaryOptions {
  /** Whether to validate that binary files exist */
  validateExists?: boolean
  /** Function to check if a file exists (for filesystem abstraction) */
  fileExists?: (path: string) => Promise<boolean>
  /** Function to list directory contents (for directories.bin) */
  listDirectory?: (path: string) => Promise<string[]>
}

/**
 * Minimal package.json fields needed for binary resolution
 */
export interface PackageJsonForBin {
  name: string
  version?: string
  bin?: string | Record<string, string> | null
  directories?: {
    bin?: string
  }
}

// ============================================================================
// STUB IMPLEMENTATIONS (RED PHASE)
// ============================================================================

/**
 * Resolve a specific binary from a package
 *
 * @param pkg - Package.json object
 * @param binaryName - Optional specific binary name to resolve
 * @param options - Resolution options
 * @returns Binary resolution result
 */
export function resolveBinaryPath(
  pkg: PackageJsonForBin,
  binaryName?: string,
  options?: ResolveBinaryOptions
): BinaryResolutionResult | Promise<BinaryResolutionResult> {
  // RED phase stub - always returns not found
  throw new Error('Not implemented: resolveBinaryPath')
}

/**
 * Resolve all binaries from a package
 *
 * @param pkg - Package.json object
 * @param options - Resolution options
 * @returns Object mapping binary names to paths
 */
export function resolveBinaries(
  pkg: PackageJsonForBin,
  options?: ResolveBinaryOptions
): Record<string, string> | Promise<Record<string, string>> {
  // RED phase stub - always returns empty
  throw new Error('Not implemented: resolveBinaries')
}
