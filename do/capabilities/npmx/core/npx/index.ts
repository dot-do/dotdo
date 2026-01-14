/**
 * NPX Core Modules
 *
 * This module provides execution and polyfill functionality for running
 * npm packages in edge runtimes.
 *
 * @module npmx/core/npx
 */

// Classification - determine execution tier for packages
export * from './classification.js'

// ESM Resolver - resolve package entry points
export * from './esm-resolver.js'

// Process polyfill - Node.js process object for Workers
export {
  createProcessPolyfill,
  ProcessExitError,
  type ProcessPolyfill,
  type ProcessPolyfillOptions,
  type ProcessStream,
  type ProcessStdin,
  type HrTime,
} from './process.js'
