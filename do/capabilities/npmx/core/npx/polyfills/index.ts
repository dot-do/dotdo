/**
 * Node.js Polyfills for Edge Runtimes
 *
 * The polyfill layer provides Node.js built-in module compatibility
 * for Tier 2 packages running in V8 isolates:
 * - fs polyfill using fsx.do
 * - path polyfill (pure JavaScript)
 * - crypto polyfill using Web Crypto API
 * - buffer polyfill
 * - process polyfill
 * - events polyfill
 * - stream polyfill
 *
 * @module npmx/core/npx/polyfills
 */

// FS Polyfill - backed by fsx.do
export { createFsPolyfill } from './fs.js'
export type { FsPolyfill, FsBuffer, FsStats, CreateFsPolyfillOptions, FsPolyfillInterface } from './fs.js'
