/**
 * DuckDB WASM Loader for Cloudflare Workers
 *
 * This module wraps the Emscripten-generated loader to make it work
 * in the Cloudflare Workers runtime where import.meta.url doesn't
 * provide a useful URL.
 *
 * The key insight is that when we provide instantiateWasm, the loader
 * doesn't need to fetch the WASM binary - we provide the pre-compiled module.
 */

import type { DuckDBModule, DuckDBModuleConfig } from '../wasm/duckdb-worker-cf.js'
// Use Cloudflare-compatible loader (patched to not use import.meta.url)
import createDuckDBLoader from '../wasm/duckdb-worker-cf.js'

/**
 * Create a DuckDB module instance using a pre-compiled WASM module
 *
 * This is the primary entry point for Workers - it bypasses all URL
 * fetching by providing the WASM module directly.
 *
 * @param wasmModule Pre-compiled WebAssembly.Module from Workers binding
 * @returns Promise resolving to initialized DuckDB module
 */
export async function createDuckDBFromModule(wasmModule: WebAssembly.Module): Promise<DuckDBModule> {
  const config: DuckDBModuleConfig = {
    // Bypass all WASM fetching by providing instantiateWasm
    instantiateWasm: (imports, receiveInstance) => {
      WebAssembly.instantiate(wasmModule, imports).then((instance) => {
        receiveInstance(instance, wasmModule)
      })
      return {} // Signal async instantiation
    },
    // Prevent any file locating attempts
    locateFile: (path: string) => {
      // This should never be called when instantiateWasm is provided,
      // but just in case, return a dummy path
      console.warn(`DuckDB loader tried to locate file: ${path}`)
      return path
    },
    // Suppress any print/error output during initialization
    print: () => {},
    printErr: () => {},
  }

  return createDuckDBLoader(config)
}

// Re-export the types
export type { DuckDBModule, DuckDBModuleConfig }
