/**
 * WASM Module Path Configuration
 *
 * This module provides a centralized, single source of truth for all WASM module
 * paths in the chdb-wasm package. All WASM-related code should import paths from
 * this module to ensure consistency and prevent path mismatches.
 *
 * ## Directory Structure
 *
 * All WASM files are located at `wasm/dist/modular/` relative to the package root:
 *
 * ```
 * wasm/dist/modular/
 * ├── core.wasm (~29KB)              - Core WASM module (MAIN_MODULE)
 * ├── core.js (~78KB)                - Emscripten JavaScript glue
 * ├── aggregates.side.wasm (~62KB)   - Aggregation functions side module
 * ├── memory_engine.side.wasm (~75KB)- Memory engine side module
 * ├── ext-math.wasm (~5KB)           - Math extensions
 * ├── ext-geo.wasm (~14KB)           - Geo extensions
 * └── ext-json.wasm (~8KB)           - JSON extensions
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import {
 *   WASM_MODULE_PATH,
 *   CORE_MODULE_PATH,
 *   CORE_WASM_PATH,
 *   SIDE_MODULES,
 *   EXTENSION_MODULES,
 *   getWasmPath,
 *   validateWasmPath,
 * } from './wasm/paths';
 *
 * // Load core module
 * const coreModule = await import(CORE_MODULE_PATH);
 *
 * // Load a side module
 * const aggregatesWasm = await fetch(SIDE_MODULES.aggregates);
 *
 * // Load a specific extension
 * const mathExtension = await fetch(EXTENSION_MODULES.math);
 *
 * // Get path for a custom module
 * const customPath = getWasmPath('custom.wasm');
 * ```
 *
 * @module wasm/paths
 */

// =============================================================================
// Core Path Constants
// =============================================================================

/**
 * Base path to the WASM modules directory.
 *
 * This is the root directory where all compiled WASM modules are located.
 * All other path constants are derived from this base path.
 *
 * @constant
 * @type {string}
 * @example
 * // Construct a path to a custom module
 * const customModulePath = `${WASM_MODULE_PATH}/my-module.wasm`;
 */
export const WASM_MODULE_PATH = 'wasm/dist/modular' as const;

/**
 * Path to the core WASM module's JavaScript glue file.
 *
 * This is the Emscripten-generated JavaScript file that provides the runtime
 * environment for the core WASM module. It handles memory management,
 * function exports, and WebAssembly instantiation.
 *
 * @constant
 * @type {string}
 * @example
 * // Dynamic import of core module
 * const { default: createCoreModule } = await import(CORE_MODULE_PATH);
 * const module = await createCoreModule();
 */
export const CORE_MODULE_PATH = `${WASM_MODULE_PATH}/core.js` as const;

/**
 * Path to the core WASM binary file.
 *
 * This is the compiled WebAssembly binary for the core module (MAIN_MODULE).
 * It provides system libraries (malloc, free, etc.) to side modules and
 * exports VFS functions for storage abstraction.
 *
 * @constant
 * @type {string}
 * @example
 * // Fetch and compile the WASM binary
 * const response = await fetch(CORE_WASM_PATH);
 * const wasmBytes = await response.arrayBuffer();
 * const module = await WebAssembly.compile(wasmBytes);
 */
export const CORE_WASM_PATH = `${WASM_MODULE_PATH}/core.wasm` as const;

// =============================================================================
// Side Module Constants
// =============================================================================

/**
 * Available side modules (SIDE_MODULE) that extend the core functionality.
 *
 * Side modules are dynamically linked WASM modules that share memory with
 * the core module. They are loaded via Emscripten's loadDynamicLibrary().
 *
 * @constant
 * @type {Readonly<{aggregates: string, memoryEngine: string}>}
 * @property {string} aggregates - Aggregation functions (SUM, AVG, COUNT, etc.)
 * @property {string} memoryEngine - Memory engine for in-memory table storage
 *
 * @example
 * // Load aggregates side module
 * await coreModule.loadDynamicLibrary(SIDE_MODULES.aggregates, {
 *   loadAsync: true,
 *   global: true,
 * });
 */
export const SIDE_MODULES = {
  /** Path to the aggregates side module (SUM, AVG, COUNT, etc.) */
  aggregates: `${WASM_MODULE_PATH}/aggregates.side.wasm`,
  /** Path to the memory engine side module (in-memory table storage) */
  memoryEngine: `${WASM_MODULE_PATH}/memory_engine.side.wasm`,
} as const;

/**
 * Type representing valid side module names.
 */
export type SideModuleName = keyof typeof SIDE_MODULES;

// =============================================================================
// Extension Module Constants
// =============================================================================

/**
 * Available extension modules for additional SQL functions.
 *
 * Extension modules provide specialized functionality that can be loaded
 * on-demand to keep the core module size minimal. Each extension is a
 * standalone WASM module that integrates with the core.
 *
 * @constant
 * @type {Readonly<{math: string, geo: string, json: string}>}
 * @property {string} math - Mathematical functions (factorial, fibonacci, etc.)
 * @property {string} geo - Geospatial functions (distance, H3, etc.)
 * @property {string} json - JSON manipulation functions (extract, parse, etc.)
 *
 * @example
 * // Load geo extension for geospatial queries
 * const geoWasm = await fetch(EXTENSION_MODULES.geo);
 * const geoModule = await WebAssembly.compile(await geoWasm.arrayBuffer());
 */
export const EXTENSION_MODULES = {
  /** Path to the math extension (factorial, fibonacci, gcd, etc.) */
  math: `${WASM_MODULE_PATH}/ext-math.wasm`,
  /** Path to the geo extension (geoDistance, H3, point-in-polygon, etc.) */
  geo: `${WASM_MODULE_PATH}/ext-geo.wasm`,
  /** Path to the JSON extension (extract, parse, stringify, etc.) */
  json: `${WASM_MODULE_PATH}/ext-json.wasm`,
} as const;

/**
 * Type representing valid extension module names.
 */
export type ExtensionModuleName = keyof typeof EXTENSION_MODULES;

// =============================================================================
// Path Utility Functions
// =============================================================================

/**
 * Constructs the full path to a WASM module relative to the package root.
 *
 * Use this function when you need to reference a WASM file that is not
 * covered by the predefined constants (SIDE_MODULES, EXTENSION_MODULES).
 *
 * @param {string} moduleName - The name of the module file (e.g., 'custom.wasm')
 * @returns {string} The full path to the module (e.g., 'wasm/dist/modular/custom.wasm')
 *
 * @example
 * // Get path to a custom extension
 * const customExtPath = getWasmPath('ext-custom.wasm');
 * // Returns: 'wasm/dist/modular/ext-custom.wasm'
 *
 * @example
 * // Get path to a side module by name
 * const sideModulePath = getWasmPath('my-module.side.wasm');
 * // Returns: 'wasm/dist/modular/my-module.side.wasm'
 */
export function getWasmPath(moduleName: string): string {
  return `${WASM_MODULE_PATH}/${moduleName}`;
}

/**
 * Validates that a path is within the expected WASM module directory.
 *
 * This function performs runtime validation to ensure that a given path
 * is a valid WASM module path. It helps catch configuration errors early.
 *
 * @param {string} path - The path to validate
 * @returns {{ valid: boolean; error?: string }} Validation result with optional error message
 *
 * @example
 * // Validate a correct path
 * const result1 = validateWasmPath('wasm/dist/modular/core.wasm');
 * // Returns: { valid: true }
 *
 * @example
 * // Validate an incorrect path
 * const result2 = validateWasmPath('wasm/core/dist/core.wasm');
 * // Returns: { valid: false, error: 'Path does not start with expected base...' }
 *
 * @example
 * // Use in runtime validation
 * const modulePath = getWasmPath('my-module.wasm');
 * const validation = validateWasmPath(modulePath);
 * if (!validation.valid) {
 *   throw new Error(`Invalid WASM path: ${validation.error}`);
 * }
 */
export function validateWasmPath(path: string): { valid: boolean; error?: string } {
  if (!path) {
    return { valid: false, error: 'Path is empty or undefined' };
  }

  if (!path.startsWith(WASM_MODULE_PATH)) {
    return {
      valid: false,
      error: `Path does not start with expected base '${WASM_MODULE_PATH}'. Got: '${path}'`,
    };
  }

  // Check for legacy incorrect paths
  if (path.includes('wasm/core/dist')) {
    return {
      valid: false,
      error: `Path contains legacy 'wasm/core/dist' which should be '${WASM_MODULE_PATH}'`,
    };
  }

  // Validate file extension for WASM files
  if (path.endsWith('.wasm') || path.endsWith('.js')) {
    return { valid: true };
  }

  // Allow directory paths
  if (path === WASM_MODULE_PATH) {
    return { valid: true };
  }

  return {
    valid: false,
    error: `Path should end with '.wasm' or '.js' extension. Got: '${path}'`,
  };
}

/**
 * Gets a side module path by name with runtime validation.
 *
 * @param {SideModuleName} name - The side module name
 * @returns {string} The full path to the side module
 * @throws {Error} If the side module name is not valid
 *
 * @example
 * const aggregatesPath = getSideModulePath('aggregates');
 * // Returns: 'wasm/dist/modular/aggregates.side.wasm'
 */
export function getSideModulePath(name: SideModuleName): string {
  const path = SIDE_MODULES[name];
  if (!path) {
    throw new Error(`Unknown side module: '${name}'. Available: ${Object.keys(SIDE_MODULES).join(', ')}`);
  }
  return path;
}

/**
 * Gets an extension module path by name with runtime validation.
 *
 * @param {ExtensionModuleName} name - The extension module name
 * @returns {string} The full path to the extension module
 * @throws {Error} If the extension module name is not valid
 *
 * @example
 * const geoPath = getExtensionModulePath('geo');
 * // Returns: 'wasm/dist/modular/ext-geo.wasm'
 */
export function getExtensionModulePath(name: ExtensionModuleName): string {
  const path = EXTENSION_MODULES[name];
  if (!path) {
    throw new Error(`Unknown extension module: '${name}'. Available: ${Object.keys(EXTENSION_MODULES).join(', ')}`);
  }
  return path;
}

/**
 * Lists all available WASM module paths.
 *
 * Returns an object containing all predefined WASM paths for inspection
 * or iteration purposes.
 *
 * @returns {object} Object containing all WASM paths organized by category
 *
 * @example
 * const paths = listAllWasmPaths();
 * console.log(paths.core);       // { module: '...core.js', wasm: '...core.wasm' }
 * console.log(paths.sideModules); // { aggregates: '...', memoryEngine: '...' }
 * console.log(paths.extensions);  // { math: '...', geo: '...', json: '...' }
 */
export function listAllWasmPaths(): {
  basePath: string;
  core: { module: string; wasm: string };
  sideModules: typeof SIDE_MODULES;
  extensions: typeof EXTENSION_MODULES;
} {
  return {
    basePath: WASM_MODULE_PATH,
    core: {
      module: CORE_MODULE_PATH,
      wasm: CORE_WASM_PATH,
    },
    sideModules: SIDE_MODULES,
    extensions: EXTENSION_MODULES,
  };
}
