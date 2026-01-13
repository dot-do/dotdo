/**
 * Content-Addressable Storage (CAS) Module
 *
 * Provides git-compatible content-addressable storage for fsx.do.
 * Objects are stored using their content hash as the identifier,
 * enabling deduplication and content integrity verification.
 *
 * @example
 * ```typescript
 * import { ContentAddressableFS, sha1, compress, decompress } from 'fsx.do/cas'
 *
 * const cas = new ContentAddressableFS(storage)
 * const hash = await cas.putObject(data, 'blob')
 * const obj = await cas.getObject(hash)
 * ```
 *
 * @packageDocumentation
 */

// Main CAS class
export {
  ContentAddressableFS,
  type CASObject,
  type CASStorage,
  type ObjectType,
} from './content-addressable-fs.js'

// Hash utilities
export { sha1, sha256, bytesToHex, hexToBytes } from './hash.js'

// Git object format
export {
  createGitObject,
  parseGitObject,
  createHeader,
  parseHeader,
  type GitObjectType,
} from './git-object.js'

// Compression
export { compress, decompress } from './compression.js'

// Path mapping
export { hashToPath, pathToHash } from './path-mapping.js'

// Low-level functions
export { putObject, type ObjectStorage } from './put-object.js'
export { getObject, type GitObject, type GetObjectStorage } from './get-object.js'
export { hasObject, setStorage, getStorage, type HasObjectStorage } from './has-object.js'
