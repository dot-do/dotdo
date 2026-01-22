/**
 * Backend Factory
 *
 * Provides factory functions for creating backend instances with automatic
 * detection and selection of the best available backend.
 */

import { Backend, BackendName, BackendCapabilities } from './base';
import { WasmBackend, WasmBackendConfig, isWasmSupported } from './wasm';
import { SandboxBackend, SandboxBackendConfig, isSandboxSupported, findClickHouseBinary } from './sandbox';
import { ClickHouseBackend, ClickHouseBackendConfig, isClickHouseAvailable } from './clickhouse';
import { BackendNotAvailableError, ConnectionError } from '../types';

/**
 * Combined backend configuration
 */
export interface BackendConfig {
  /** WASM backend configuration */
  wasm?: WasmBackendConfig;
  /** Sandbox backend configuration */
  sandbox?: SandboxBackendConfig;
  /** ClickHouse server configuration */
  clickhouse?: ClickHouseBackendConfig;
}

/**
 * Options for backend selection
 */
export interface BackendSelectionOptions {
  /** Specific backend to use (overrides auto-detection) */
  backend?: BackendName | 'auto';
  /** Priority order for auto-detection (default: ['clickhouse', 'sandbox', 'wasm']) */
  priority?: BackendName[];
  /** Backend-specific configurations */
  config?: BackendConfig;
  /** Timeout for availability checks in milliseconds (default: 5000) */
  checkTimeout?: number;
}

/**
 * Result of backend availability check
 */
export interface BackendAvailability {
  wasm: boolean;
  sandbox: boolean;
  clickhouse: boolean;
}

/**
 * Check availability of all backends
 */
export async function checkBackendAvailability(
  config?: BackendConfig,
  timeout: number = 5000
): Promise<BackendAvailability> {
  const availability: BackendAvailability = {
    wasm: false,
    sandbox: false,
    clickhouse: false,
  };

  // Check WASM availability (synchronous)
  availability.wasm = isWasmSupported();

  // Check sandbox availability
  if (isSandboxSupported()) {
    // If a specific binary is configured, assume it exists
    if (config?.sandbox?.binary) {
      availability.sandbox = true;
    } else {
      // Try to find the ClickHouse binary
      const binary = await findClickHouseBinary();
      availability.sandbox = binary !== null;
    }
  }

  // Check ClickHouse server availability
  if (config?.clickhouse?.host) {
    availability.clickhouse = await isClickHouseAvailable(config.clickhouse.host, timeout);
  }

  return availability;
}

/**
 * Detect the best available backend based on environment and configuration
 */
export async function detectBackend(options?: BackendSelectionOptions): Promise<BackendName> {
  const priority = options?.priority ?? ['clickhouse', 'sandbox', 'wasm'];
  const timeout = options?.checkTimeout ?? 5000;

  const availability = await checkBackendAvailability(options?.config, timeout);

  // Check backends in priority order
  for (const backend of priority) {
    if (availability[backend]) {
      return backend;
    }
  }

  // No backend available
  const availableList = Object.entries(availability)
    .filter(([, available]) => available)
    .map(([name]) => name);

  if (availableList.length === 0) {
    throw new ConnectionError(
      'No available backend found. Please ensure at least one of the following:\n' +
      '- WebAssembly is supported in your environment (WASM backend)\n' +
      '- ClickHouse binary is installed (Sandbox backend)\n' +
      '- A ClickHouse server is accessible (ClickHouse backend)'
    );
  }

  // This shouldn't happen if logic is correct, but return first available
  return availableList[0] as BackendName;
}

/**
 * Create a backend instance
 */
export function createBackend(
  name: BackendName,
  config?: BackendConfig
): Backend {
  switch (name) {
    case 'wasm':
      if (!isWasmSupported()) {
        throw new BackendNotAvailableError('wasm');
      }
      return new WasmBackend(config?.wasm);

    case 'sandbox':
      if (!isSandboxSupported()) {
        throw new BackendNotAvailableError('sandbox');
      }
      return new SandboxBackend(config?.sandbox);

    case 'clickhouse':
      if (!config?.clickhouse?.host) {
        throw new ConnectionError('ClickHouse host is required for clickhouse backend');
      }
      return new ClickHouseBackend(config.clickhouse);

    default:
      throw new BackendNotAvailableError(name);
  }
}

/**
 * Create a backend with automatic detection
 */
export async function createAutoBackend(
  options?: BackendSelectionOptions
): Promise<Backend> {
  // If a specific backend is requested, use it
  if (options?.backend && options.backend !== 'auto') {
    return createBackend(options.backend, options?.config);
  }

  // Auto-detect the best backend
  const backendName = await detectBackend(options);
  return createBackend(backendName, options?.config);
}

/**
 * Backend registry for managing multiple backend instances
 */
export class BackendRegistry {
  private backends: Map<string, Backend> = new Map();
  private defaultBackendName: string | null = null;

  /**
   * Register a backend instance
   */
  register(name: string, backend: Backend): void {
    this.backends.set(name, backend);

    // Set as default if it's the first one
    if (this.defaultBackendName === null) {
      this.defaultBackendName = name;
    }
  }

  /**
   * Get a backend by name
   */
  get(name: string): Backend | undefined {
    return this.backends.get(name);
  }

  /**
   * Get the default backend
   */
  getDefault(): Backend | undefined {
    if (this.defaultBackendName === null) {
      return undefined;
    }
    return this.backends.get(this.defaultBackendName);
  }

  /**
   * Set the default backend
   */
  setDefault(name: string): void {
    if (!this.backends.has(name)) {
      throw new BackendNotAvailableError(name);
    }
    this.defaultBackendName = name;
  }

  /**
   * Check if a backend is registered
   */
  has(name: string): boolean {
    return this.backends.has(name);
  }

  /**
   * List all registered backend names
   */
  list(): string[] {
    return Array.from(this.backends.keys());
  }

  /**
   * Get capabilities of all registered backends
   */
  getCapabilities(): Map<string, BackendCapabilities> {
    const capabilities = new Map<string, BackendCapabilities>();
    for (const [name, backend] of this.backends) {
      capabilities.set(name, backend.capabilities);
    }
    return capabilities;
  }

  /**
   * Find backends that support specific capabilities
   */
  findByCapability(requirement: Partial<BackendCapabilities>): string[] {
    const matching: string[] = [];

    for (const [name, backend] of this.backends) {
      const caps = backend.capabilities;
      let matches = true;

      if (requirement.streaming !== undefined && caps.streaming !== requirement.streaming) {
        matches = false;
      }
      if (requirement.sessions !== undefined && caps.sessions !== requirement.sessions) {
        matches = false;
      }
      if (requirement.insert !== undefined && caps.insert !== requirement.insert) {
        matches = false;
      }
      if (requirement.maxMemory !== undefined && caps.maxMemory < requirement.maxMemory) {
        matches = false;
      }
      if (requirement.engines !== undefined) {
        const hasAllEngines = requirement.engines.every(engine => caps.engines.includes(engine));
        if (!hasAllEngines) {
          matches = false;
        }
      }

      if (matches) {
        matching.push(name);
      }
    }

    return matching;
  }

  /**
   * Dispose all backends and clear registry
   */
  dispose(): void {
    for (const backend of this.backends.values()) {
      backend.dispose?.();
    }
    this.backends.clear();
    this.defaultBackendName = null;
  }

  /**
   * Dispose a specific backend
   */
  disposeBackend(name: string): void {
    const backend = this.backends.get(name);
    if (backend) {
      backend.dispose?.();
      this.backends.delete(name);

      // Update default if necessary
      if (this.defaultBackendName === name) {
        this.defaultBackendName = this.backends.size > 0
          ? this.backends.keys().next().value
          : null;
      }
    }
  }
}

/**
 * Global backend registry instance
 */
export const globalRegistry = new BackendRegistry();

/**
 * Create and register backends based on configuration
 */
export async function initializeBackends(
  config?: BackendConfig,
  options?: {
    registerGlobally?: boolean;
    setDefault?: BackendName;
  }
): Promise<BackendRegistry> {
  const registry = options?.registerGlobally ? globalRegistry : new BackendRegistry();
  const availability = await checkBackendAvailability(config);

  // Initialize available backends
  if (availability.wasm) {
    try {
      const backend = new WasmBackend(config?.wasm);
      registry.register('wasm', backend);
    } catch {
      // WASM initialization failed, skip
    }
  }

  if (availability.sandbox) {
    try {
      const backend = new SandboxBackend(config?.sandbox);
      registry.register('sandbox', backend);
    } catch {
      // Sandbox initialization failed, skip
    }
  }

  if (availability.clickhouse && config?.clickhouse?.host) {
    try {
      const backend = new ClickHouseBackend(config.clickhouse);
      registry.register('clickhouse', backend);
    } catch {
      // ClickHouse initialization failed, skip
    }
  }

  // Set default if specified
  if (options?.setDefault && registry.has(options.setDefault)) {
    registry.setDefault(options.setDefault);
  }

  return registry;
}
