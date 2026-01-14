/**
 * npmx Durable Object exports
 *
 * @module npmx/do
 */

export { NpmDO, type PackageMetadata, type ExecResult } from './NpmDO.js'
export type { InstallResult } from '../types.js'
export { NpmDOWrapper, type Env } from './worker.js'
export { default } from './worker.js'

// Fetch timeout utilities for external use
export {
  fetchWithTimeout,
  FetchTimeoutError,
  DEFAULT_FETCH_TIMEOUT,
  type FetchTimeoutOptions,
} from './fetch-timeout.js'
