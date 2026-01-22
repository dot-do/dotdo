/**
 * WASM Module Loader for Testing
 *
 * This module loads REAL WASM files for testing - NO MOCKS.
 * Tests use real WebAssembly modules from the wasm/dist directory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load a real WASM module from the wasm/dist/modular directory.
 *
 * @param wasmFileName - Name of the WASM file to load (e.g., 'core.wasm')
 * @returns The compiled WebAssembly module or null if not found
 */
export async function loadWasmModule(wasmFileName: string): Promise<WebAssembly.Module | null> {
  const wasmPath = path.resolve(__dirname, '../../wasm/dist/modular', wasmFileName);

  try {
    const wasmBuffer = fs.readFileSync(wasmPath);
    const module = await WebAssembly.compile(wasmBuffer);
    return module;
  } catch (error) {
    console.error(`Failed to load WASM module '${wasmFileName}':`, error);
    return null;
  }
}

/**
 * Load and instantiate a WASM module with imports.
 *
 * @param wasmFileName - Name of the WASM file
 * @param imports - Import object for WebAssembly instantiation
 * @returns The instantiated WebAssembly instance or null if not found
 */
export async function instantiateWasmModule(
  wasmFileName: string,
  imports: WebAssembly.Imports = {}
): Promise<WebAssembly.Instance | null> {
  const wasmPath = path.resolve(__dirname, '../../wasm/dist/modular', wasmFileName);

  try {
    const wasmBuffer = fs.readFileSync(wasmPath);
    const { instance } = await WebAssembly.instantiate(wasmBuffer, imports);
    return instance;
  } catch (error) {
    console.error(`Failed to instantiate WASM module '${wasmFileName}':`, error);
    return null;
  }
}

/**
 * Load the core WASM module using the Emscripten loader.
 *
 * This imports the core.js Emscripten module and initializes it,
 * returning the full Module object with HEAP views and exports.
 */
export async function loadCoreModule(): Promise<unknown> {
  const corePath = path.resolve(__dirname, '../../wasm/dist/modular/core.js');

  try {
    // Dynamically import the Emscripten loader
    const { default: createCoreModule } = await import(corePath);

    // Initialize the module with custom locateFile to find .wasm
    const module = await createCoreModule({
      locateFile: (filename: string) => {
        if (filename.endsWith('.wasm')) {
          return path.resolve(__dirname, '../../wasm/dist/modular', filename);
        }
        return filename;
      },
    });

    return module;
  } catch (error) {
    console.error('Failed to load core WASM module:', error);
    return null;
  }
}

// Export helper functions for loading WASM
export default {
  loadWasmModule,
  instantiateWasmModule,
  loadCoreModule,
};
