/**
 * Runtime environment detection and backend auto-selection for @dotdo/chdb
 *
 * This module provides utilities for detecting the runtime environment
 * and automatically selecting the most appropriate backend.
 */

/**
 * Supported runtime environments
 */
export type Environment = 'browser' | 'worker' | 'node' | 'deno' | 'container';

/**
 * Available backend types
 */
export type Backend = 'wasm' | 'sandbox' | 'auto';

/**
 * Detect the current runtime environment
 *
 * Detection order:
 * 1. Browser (window + document present)
 * 2. Web Worker (self + importScripts available)
 * 3. Deno (Deno global present)
 * 4. Container (CF_CONTAINER env var set)
 * 5. Node.js (default fallback)
 *
 * @returns The detected environment type
 *
 * @example
 * ```typescript
 * const env = detectEnvironment();
 * console.log(env); // 'node', 'browser', 'worker', 'deno', or 'container'
 * ```
 */
export function detectEnvironment(): Environment {
  // Check for browser environment
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return 'browser';
  }

  // Check for Web Worker environment
  // Note: importScripts is a function available in Web Workers
  if (
    typeof self !== 'undefined' &&
    typeof (self as unknown as { importScripts?: unknown }).importScripts === 'function'
  ) {
    return 'worker';
  }

  // Check for Deno runtime
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (globalThis as any).Deno !== 'undefined') {
    return 'deno';
  }

  // Check for container environment (Cloudflare Sandbox)
  // This check requires process to be defined, so we do it safely
  if (typeof process !== 'undefined' && process.env?.CF_CONTAINER === 'true') {
    return 'container';
  }

  // Also check for Cloudflare Workers SANDBOX binding
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((globalThis as any).SANDBOX !== undefined) {
    return 'container';
  }

  // Default to Node.js
  return 'node';
}

/**
 * Select the most appropriate backend for a given environment
 *
 * Selection logic:
 * - Browser/Worker: Use WASM (native binaries not available)
 * - Container: Use Sandbox (native chdb available via sandbox-sdk)
 * - Node/Deno: Check if sandbox binary exists, fallback to WASM
 *
 * @param environment - The detected runtime environment
 * @returns The recommended backend type
 *
 * @example
 * ```typescript
 * const env = detectEnvironment();
 * const backend = selectBackend(env);
 * console.log(backend); // 'wasm' or 'sandbox'
 * ```
 */
export function selectBackend(environment: Environment): Exclude<Backend, 'auto'> {
  switch (environment) {
    case 'browser':
    case 'worker':
      // Browser and worker environments can only use WASM
      return 'wasm';

    case 'container':
      // Cloudflare container/sandbox has native chdb available
      return 'sandbox';

    case 'node':
    case 'deno':
      // For Node.js and Deno, we prefer sandbox if available
      // The async check will be done at runtime by the client factory
      // This returns the preferred backend; actual availability is checked separately
      return 'sandbox';

    default:
      // Fallback to WASM for unknown environments
      return 'wasm';
  }
}

/**
 * Check if the sandbox backend (native chdb binary) is available
 *
 * This function checks for:
 * - Cloudflare Workers SANDBOX binding
 * - Node.js: checks for chdb binary at standard paths
 * - Deno: checks for chdb binary using Deno.stat
 *
 * @param customBinaryPath - Optional custom path to the chdb binary
 * @returns Promise resolving to true if sandbox backend is available
 *
 * @example
 * ```typescript
 * const available = await checkSandboxAvailable();
 * if (available) {
 *   const client = await createClient({ backend: 'sandbox' });
 * }
 *
 * // With custom binary path
 * const available = await checkSandboxAvailable('/opt/chdb/bin/chdb');
 * ```
 */
export async function checkSandboxAvailable(customBinaryPath?: string): Promise<boolean> {
  const env = detectEnvironment();

  // In container/Cloudflare Workers with SANDBOX binding
  if (env === 'container') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).SANDBOX !== undefined;
  }

  // Standard binary paths to check
  const binaryPaths = customBinaryPath
    ? [customBinaryPath]
    : [
        '/usr/local/bin/chdb',
        '/usr/bin/chdb',
        '/opt/chdb/bin/chdb',
        // Also check relative to node_modules for local installs
        './node_modules/.bin/chdb',
      ];

  // In Node.js environment
  if (env === 'node') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { access, constants } = await import('fs/promises').then(m => ({
        access: m.access,
        constants: (require('fs') as typeof import('fs')).constants,
      }));

      for (const binaryPath of binaryPaths) {
        try {
          await access(binaryPath, constants.X_OK);
          return true;
        } catch {
          // Try next path
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  // In Deno environment
  if (env === 'deno') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Deno = (globalThis as any).Deno;
      for (const binaryPath of binaryPaths) {
        try {
          const stat = await Deno.stat(binaryPath);
          // Check if file exists and has some form of executable permission
          if (stat.isFile && (stat.mode & 0o111) !== 0) {
            return true;
          }
        } catch {
          // Try next path
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  // Browser and worker environments cannot use sandbox
  return false;
}

/**
 * Check if the WASM backend is available in the current environment
 *
 * Checks for:
 * - WebAssembly global availability
 * - Ability to compile a minimal WASM module
 *
 * @returns Promise resolving to true if WASM backend is available
 *
 * @example
 * ```typescript
 * const available = await checkWasmAvailable();
 * if (available) {
 *   const client = await createClient({ backend: 'wasm' });
 * }
 * ```
 */
export async function checkWasmAvailable(): Promise<boolean> {
  // Check for WebAssembly support
  if (typeof WebAssembly === 'undefined') {
    return false;
  }

  // Verify that we can compile a minimal WASM module
  try {
    // Minimal valid WASM module (magic number + version)
    const minimalWasm = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // WASM magic number (\0asm)
      0x01, 0x00, 0x00, 0x00, // WASM version 1
    ]);

    const module = await WebAssembly.compile(minimalWasm);
    return module instanceof WebAssembly.Module;
  } catch {
    return false;
  }
}

/**
 * Auto-detect the best available backend for the current environment
 *
 * This function combines environment detection and backend availability
 * checks to select the optimal backend.
 *
 * @param options - Optional configuration
 * @param options.preferSandbox - Prefer sandbox over WASM when both available (default: true)
 * @param options.customBinaryPath - Custom path to chdb binary for sandbox
 * @returns Promise resolving to the best available backend
 *
 * @example
 * ```typescript
 * const backend = await autoSelectBackend();
 * const client = await createClient({ backend });
 * ```
 */
export async function autoSelectBackend(options?: {
  preferSandbox?: boolean;
  customBinaryPath?: string;
}): Promise<Exclude<Backend, 'auto'>> {
  const env = detectEnvironment();
  const preferSandbox = options?.preferSandbox ?? true;

  // Browser and worker can only use WASM
  if (env === 'browser' || env === 'worker') {
    if (await checkWasmAvailable()) {
      return 'wasm';
    }
    throw new Error('No available backend: WebAssembly is not supported in this environment');
  }

  // Container environment should use sandbox
  if (env === 'container') {
    if (await checkSandboxAvailable(options?.customBinaryPath)) {
      return 'sandbox';
    }
    // Fallback to WASM if sandbox not available
    if (await checkWasmAvailable()) {
      return 'wasm';
    }
    throw new Error('No available backend in container environment');
  }

  // Node.js and Deno: check both backends and select based on preference
  const [sandboxAvailable, wasmAvailable] = await Promise.all([
    checkSandboxAvailable(options?.customBinaryPath),
    checkWasmAvailable(),
  ]);

  if (preferSandbox && sandboxAvailable) {
    return 'sandbox';
  }

  if (wasmAvailable) {
    return 'wasm';
  }

  if (sandboxAvailable) {
    return 'sandbox';
  }

  throw new Error(
    'No available backend found. Install chdb binary for sandbox backend or ensure WebAssembly support.'
  );
}

/**
 * Get detailed information about the current environment and available backends
 *
 * Useful for debugging and diagnostics.
 *
 * @returns Promise resolving to environment and backend availability info
 *
 * @example
 * ```typescript
 * const info = await getEnvironmentInfo();
 * console.log(info);
 * // {
 * //   environment: 'node',
 * //   sandboxAvailable: true,
 * //   wasmAvailable: true,
 * //   recommendedBackend: 'sandbox'
 * // }
 * ```
 */
export async function getEnvironmentInfo(): Promise<{
  environment: Environment;
  sandboxAvailable: boolean;
  wasmAvailable: boolean;
  recommendedBackend: Exclude<Backend, 'auto'>;
}> {
  const environment = detectEnvironment();
  const [sandboxAvailable, wasmAvailable] = await Promise.all([
    checkSandboxAvailable(),
    checkWasmAvailable(),
  ]);

  let recommendedBackend: Exclude<Backend, 'auto'>;
  try {
    recommendedBackend = await autoSelectBackend();
  } catch {
    // If no backend available, default to wasm as the "recommended" one
    // (even though it's not available, it's the safer default)
    recommendedBackend = 'wasm';
  }

  return {
    environment,
    sandboxAvailable,
    wasmAvailable,
    recommendedBackend,
  };
}
