/**
 * Test Entry Point for AI Package Tests
 *
 * This entry point exports the DO class from @dotdo/do for AI-DO integration
 * tests running in vitest-pool-workers. It allows testing the integration
 * between AI template literals and real Durable Object instances.
 *
 * @module ai/test-entry
 */

// Export DO class for miniflare bindings
export { DO, type DOEnv, type DOOptions } from '../do/DO'

// Re-export AI module for tests
export * from './index'
