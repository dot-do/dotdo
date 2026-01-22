/**
 * Backend implementations for @dotdo/chdb
 *
 * This module exports different backend implementations for running chdb:
 * - sandbox: Uses Cloudflare's sandbox-sdk to run native chdb binaries
 * - wasm: WebAssembly implementation using @dotdo/chdb-wasm
 */

// Sandbox backend - runs native chdb binary via sandbox-sdk
export { createSandboxBackend, type SandboxConfig } from './sandbox';

// WASM backend - runs ClickHouse in WebAssembly
export { createWasmBackend, type WasmConfig } from './wasm';

// Re-export defaults for convenience
export { default as sandbox } from './sandbox';
export { default as wasm } from './wasm';
