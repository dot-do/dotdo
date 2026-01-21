/**
 * Test Entry Point for API Package Tests
 *
 * This entry point exports the DO class from the do package,
 * which is required for tests that need to interact with real
 * Durable Objects via cloudflare:test bindings.
 *
 * @module api/test-entry
 */

export { DO, type DOEnv, type DOOptions } from '../do/DO'
