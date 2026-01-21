/**
 * Test Entry Point for Durable Object Tests
 *
 * This minimal entry point exports only the DO class and its core dependencies,
 * without the Node.js-dependent primitives (fsx, gitx, bashx) that can't run
 * in the Workers runtime.
 *
 * Used by vitest-pool-workers tests to avoid importing node:child_process, etc.
 *
 * @module do/test-entry
 */

export { DO, type DOEnv, type DOOptions } from './DO'
