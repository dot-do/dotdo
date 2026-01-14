/**
 * CAS Path Mapping Functions
 *
 * Maps between content hashes and file paths in the content-addressable storage.
 * Uses git-style object storage: objects/xx/yyyy... where xx is first 2 hex chars.
 *
 * Supports both SHA-1 (40 char) and SHA-256 (64 char) hashes.
 */
/**
 * Convert a hash to a storage path
 * @param hash - 40 or 64 character hex string (SHA-1 or SHA-256)
 * @returns Path in format: objects/xx/yyyy...
 */
export declare function hashToPath(hash: string): string;
/**
 * Extract a hash from a storage path
 * @param path - Path in format: objects/xx/yyyy...
 * @returns Lowercase hex hash string
 */
export declare function pathToHash(path: string): string;
//# sourceMappingURL=path-mapping.d.ts.map