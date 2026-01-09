/**
 * Test Entry Point for DuckDB Worker Tests
 *
 * This file serves as the main entry point for Cloudflare Workers tests.
 * It provides access to the WASM module through Workers bindings.
 */

export interface Env {
  DUCKDB_WASM: WebAssembly.Module
}

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    return new Response('DuckDB Worker Test Entry')
  },
}
