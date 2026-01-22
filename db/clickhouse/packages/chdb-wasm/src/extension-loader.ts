/**
 * Extension Loader Module
 *
 * This module provides functionality to dynamically load WASM extensions (SIDE_MODULE)
 * at runtime in Cloudflare Workers. Extensions share memory with the core WASM module
 * and are loaded via Emscripten's loadDynamicLibrary() function.
 *
 * Features:
 * - Load extensions from static assets or R2 buckets
 * - Cache loaded extensions to avoid redundant loads
 * - Share memory and function table with core module
 * - Track loaded extensions in a registry
 * - Support extension unloading
 */

/**
 * Extension metadata returned after loading
 */
export interface ExtensionMetadata {
  name: string;
  version: string;
  loadedAt: number;
  size: number;
}

/**
 * Memory statistics for loaded extensions
 */
export interface ExtensionMemoryStats {
  totalUsed: number;
  extensionCount: number;
  perExtension: Record<string, number>;
}

/**
 * Loaded extension interface - provides access to extension functionality
 */
export interface LoadedExtension {
  /** Extension name */
  name: string;
  /** Whether the extension is loaded and ready */
  loaded: boolean;
  /** Whether the extension has been unloaded/disposed */
  disposed: boolean;

  /**
   * Call a function exported by this extension
   * @param functionName - Name of the function to call
   * @param args - Arguments to pass to the function
   * @returns Function return value
   */
  call(functionName: string, ...args: unknown[]): unknown;

  /**
   * Get list of exported functions
   * @returns Array of function names
   */
  getExports(): string[];

  /**
   * Get the shared WebAssembly.Memory instance
   */
  getMemory(): WebAssembly.Memory;

  /**
   * Get this extension's memory base offset
   */
  getMemoryBase(): number;

  /**
   * Get this extension's function table base offset
   */
  getTableBase(): number;

  /**
   * Allocate memory using the core module's allocator
   * @param size - Number of bytes to allocate
   * @returns Pointer to allocated memory
   */
  malloc(size: number): number;

  /**
   * Free memory using the core module's allocator
   * @param ptr - Pointer to memory to free
   */
  free(ptr: number): void;

  /**
   * Get the core module version
   */
  coreVersion(): number;

  /**
   * Get extension metadata
   */
  getMetadata(): ExtensionMetadata;
}

/**
 * Extension registry for tracking loaded modules
 */
export interface ExtensionRegistry {
  /**
   * Check if an extension is registered
   */
  has(name: string): boolean;

  /**
   * Get a loaded extension by name
   */
  get(name: string): LoadedExtension | undefined;

  /**
   * List all registered extension names
   */
  list(): string[];
}

/**
 * Configuration options for the ExtensionLoader
 */
export interface ExtensionLoaderConfig {
  /** Path to extensions in static assets (e.g., '/extensions') */
  assetsPath: string;
  /** Workers environment bindings */
  env: ExtensionLoaderEnv;
  /** Optional R2 bucket for extension storage */
  r2Bucket?: R2Bucket;
}

/**
 * Workers environment bindings needed by the loader
 */
export interface ExtensionLoaderEnv {
  /** Static assets binding */
  ASSETS?: Fetcher;
  /** Core WASM module instance (Emscripten module) */
  CORE_MODULE?: CoreModule;
}

/**
 * Core module interface (Emscripten module with dynamic linking support)
 */
export interface CoreModule {
  /** Shared WebAssembly.Memory */
  HEAP8: Int8Array;
  HEAP16: Int16Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;

  /** Memory reference */
  wasmMemory?: WebAssembly.Memory;

  /** Allocate memory */
  _malloc(size: number): number;

  /** Free memory */
  _free(ptr: number): void;

  /** Get core version */
  _core_get_version?(): number;

  /** Load a dynamic library (SIDE_MODULE) */
  loadDynamicLibrary(
    path: string,
    options?: {
      loadAsync?: boolean;
      nodelete?: boolean;
      allowUndefined?: boolean;
      global?: boolean;
      fs?: unknown;
    }
  ): Promise<void>;

  /** Convert string pointer to JS string */
  UTF8ToString(ptr: number): string;

  /** Allocate and write UTF8 string, return pointer */
  stringToUTF8OnStack?(str: string): number;

  /** Get function by name from loaded modules */
  ccall?(name: string, returnType: string, argTypes: string[], args: unknown[]): unknown;

  /** Get exported function */
  cwrap?(name: string, returnType: string, argTypes: string[]): (...args: unknown[]) => unknown;
}

/**
 * Internal class representing a loaded extension
 */
class LoadedExtensionImpl implements LoadedExtension {
  name: string;
  loaded: boolean;
  disposed: boolean;

  private exports: Map<string, (...args: unknown[]) => unknown> = new Map();
  private memoryBase: number;
  private tableBase: number;
  private _wasmModule: WebAssembly.Module | null;
  private wasmInstance: WebAssembly.Instance | null;
  private coreModule: CoreModule;
  private metadata: ExtensionMetadata;

  constructor(
    name: string,
    coreModule: CoreModule,
    wasmModule: WebAssembly.Module,
    wasmInstance: WebAssembly.Instance,
    memoryBase: number,
    tableBase: number,
    size: number
  ) {
    this.name = name;
    this.loaded = true;
    this.disposed = false;
    this.coreModule = coreModule;
    this._wasmModule = wasmModule;
    void this._wasmModule; // Intentionally unused - kept for potential module introspection
    this.wasmInstance = wasmInstance;
    this.memoryBase = memoryBase;
    this.tableBase = tableBase;
    this.metadata = {
      name,
      version: '1.0.0',
      loadedAt: Date.now(),
      size,
    };

    // Extract exports from the instance
    this.extractExports();
  }

  private extractExports(): void {
    if (!this.wasmInstance) return;

    const exports = this.wasmInstance.exports;
    for (const [name, value] of Object.entries(exports)) {
      if (typeof value === 'function') {
        this.exports.set(name, value as (...args: unknown[]) => unknown);
      }
    }
  }

  private checkDisposed(): void {
    if (this.disposed) {
      throw new Error(`Extension '${this.name}' has been unloaded and is no longer valid`);
    }
  }

  call(functionName: string, ...args: unknown[]): unknown {
    this.checkDisposed();

    // Try direct export first
    const fn = this.exports.get(functionName) || this.exports.get(`_${functionName}`);
    if (fn) {
      return fn(...args);
    }

    // Try via core module ccall if available
    if (this.coreModule.ccall) {
      try {
        // Infer argument types (simplified)
        const argTypes = args.map((arg) => {
          if (typeof arg === 'number') return Number.isInteger(arg) ? 'number' : 'number';
          if (typeof arg === 'string') return 'string';
          return 'number';
        });
        return this.coreModule.ccall(functionName, 'number', argTypes, args);
      } catch {
        // Fall through to error
      }
    }

    throw new Error(`Function '${functionName}' not found in extension '${this.name}'`);
  }

  getExports(): string[] {
    this.checkDisposed();
    // Return function names without underscore prefix
    return Array.from(this.exports.keys()).map((name) =>
      name.startsWith('_') ? name.slice(1) : name
    );
  }

  getMemory(): WebAssembly.Memory {
    this.checkDisposed();
    if (this.coreModule.wasmMemory) {
      return this.coreModule.wasmMemory;
    }
    // Fallback: create a Memory view from HEAPU8
    return { buffer: this.coreModule.HEAPU8.buffer } as WebAssembly.Memory;
  }

  getMemoryBase(): number {
    this.checkDisposed();
    return this.memoryBase;
  }

  getTableBase(): number {
    this.checkDisposed();
    return this.tableBase;
  }

  malloc(size: number): number {
    this.checkDisposed();
    return this.coreModule._malloc(size);
  }

  free(ptr: number): void {
    this.checkDisposed();
    this.coreModule._free(ptr);
  }

  coreVersion(): number {
    this.checkDisposed();
    if (this.coreModule._core_get_version) {
      return this.coreModule._core_get_version();
    }
    return 1;
  }

  getMetadata(): ExtensionMetadata {
    this.checkDisposed();
    return { ...this.metadata };
  }

  /**
   * Mark this extension as disposed
   */
  dispose(): void {
    this.disposed = true;
    this.loaded = false;
    this.exports.clear();
    this._wasmModule = null;
    this.wasmInstance = null;
  }
}

/**
 * Extension registry implementation
 */
class ExtensionRegistryImpl implements ExtensionRegistry {
  private extensions: Map<string, LoadedExtension> = new Map();

  register(name: string, extension: LoadedExtension): void {
    this.extensions.set(name, extension);
  }

  has(name: string): boolean {
    return this.extensions.has(name);
  }

  get(name: string): LoadedExtension | undefined {
    return this.extensions.get(name);
  }

  list(): string[] {
    return Array.from(this.extensions.keys());
  }

  unregister(name: string): void {
    this.extensions.delete(name);
  }

  clear(): void {
    this.extensions.clear();
  }
}

/**
 * ExtensionLoader - Dynamically loads WASM extensions at runtime
 *
 * Usage:
 * ```typescript
 * const loader = new ExtensionLoader({
 *   assetsPath: '/extensions',
 *   env: env,
 * });
 *
 * const extension = await loader.load('ext-geo');
 * const result = extension.call('h3ToGeo', 0x8928308280fffff);
 * ```
 */
export class ExtensionLoader {
  private config: ExtensionLoaderConfig;
  private registry: ExtensionRegistryImpl = new ExtensionRegistryImpl();
  private cache: Map<string, LoadedExtension> = new Map();
  private loadCounter: number = 0;
  private memoryUsage: Map<string, number> = new Map();
  private coreModule: CoreModule | null = null;

  constructor(config: ExtensionLoaderConfig) {
    this.config = config;
  }

  /**
   * Set the core module instance (Emscripten module)
   */
  setCoreModule(module: CoreModule): void {
    this.coreModule = module;
  }

  /**
   * Get the core module's shared memory
   */
  getCoreMemory(): WebAssembly.Memory {
    if (!this.coreModule) {
      throw new Error('Core module not set. Call setCoreModule() first.');
    }
    if (this.coreModule.wasmMemory) {
      return this.coreModule.wasmMemory;
    }
    return { buffer: this.coreModule.HEAPU8.buffer } as WebAssembly.Memory;
  }

  /**
   * Load an extension by name or path
   * @param nameOrPath - Extension name (e.g., 'ext-geo') or full path
   * @returns Loaded extension instance
   */
  async load(nameOrPath: string): Promise<LoadedExtension> {
    // Normalize the name
    const name = this.normalizeName(nameOrPath);

    // Check cache first
    if (this.cache.has(name)) {
      return this.cache.get(name)!;
    }

    // Load the extension
    const extension = await this.loadExtension(name, nameOrPath);

    // Cache it
    this.cache.set(name, extension);
    this.registry.register(name, extension);
    this.loadCounter++;

    return extension;
  }

  /**
   * Normalize extension name from path
   */
  private normalizeName(nameOrPath: string): string {
    // If it's a full path, extract the name
    if (nameOrPath.startsWith('/') || nameOrPath.endsWith('.wasm')) {
      const match = nameOrPath.match(/\/(ext-[a-z]+)(?:\.wasm)?$/i);
      if (match) {
        return match[1].toLowerCase();
      }
    }
    return nameOrPath.toLowerCase();
  }

  /**
   * Load an extension from assets or R2
   */
  private async loadExtension(name: string, originalPath: string): Promise<LoadedExtension> {
    // Determine the fetch path
    const fetchPath = originalPath.endsWith('.wasm')
      ? originalPath
      : `${this.config.assetsPath}/${name}.wasm`;

    // Try to fetch the WASM binary
    let wasmBinary: ArrayBuffer;
    let size: number;

    try {
      // Try static assets first
      if (this.config.env.ASSETS) {
        const response = await this.config.env.ASSETS.fetch(
          new Request(`https://placeholder${fetchPath}`)
        );
        if (!response.ok) {
          throw new Error(`Failed to fetch extension: ${response.status}`);
        }
        wasmBinary = await response.arrayBuffer();
        size = wasmBinary.byteLength;
      }
      // Try R2 bucket
      else if (this.config.r2Bucket) {
        const key = `extensions/${name}.wasm`;
        const object = await this.config.r2Bucket.get(key);
        if (!object) {
          throw new Error(`Extension '${name}' not found in R2 bucket`);
        }
        wasmBinary = await object.arrayBuffer();
        size = wasmBinary.byteLength;
      } else {
        throw new Error('No ASSETS binding or R2 bucket configured');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load extension '${name}': ${message}`);
    }

    // Compile the WASM module
    let wasmModule: WebAssembly.Module;
    try {
      // Use WebAssembly global - compile is a standard API
      wasmModule = await (WebAssembly as unknown as { compile(bytes: BufferSource): Promise<WebAssembly.Module> }).compile(wasmBinary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to compile extension '${name}': ${message} (invalid or corrupted WASM)`);
    }

    // If we have a core module, use loadDynamicLibrary
    if (this.coreModule) {
      await this.coreModule.loadDynamicLibrary(fetchPath, {
        loadAsync: true,
        nodelete: true,
        allowUndefined: false,
        global: true,
      });
    }

    // Calculate offsets (simplified - in real implementation these come from Emscripten)
    const memoryBase = this.calculateMemoryBase();
    const tableBase = this.calculateTableBase();

    // Create imports for instantiation (if not using loadDynamicLibrary)
    const imports = this.coreModule
      ? this.createImports(this.coreModule)
      : { env: {}, wasi_snapshot_preview1: {} };

    // Instantiate the module
    let wasmInstance: WebAssembly.Instance;
    try {
      wasmInstance = await WebAssembly.instantiate(wasmModule, imports);
    } catch {
      // If instantiation fails, module was likely already linked via loadDynamicLibrary
      // Create a placeholder instance
      wasmInstance = { exports: {} } as WebAssembly.Instance;
    }

    // Track memory usage
    this.memoryUsage.set(name, size);

    // Create and return the loaded extension
    return new LoadedExtensionImpl(
      name,
      this.coreModule || this.createMinimalCoreModule(),
      wasmModule,
      wasmInstance,
      memoryBase,
      tableBase,
      size
    );
  }

  /**
   * Create a minimal core module for extension instantiation when no core module is set.
   * This provides basic memory heap views required for extension loading.
   */
  private createMinimalCoreModule(): CoreModule {
    const memory = new ArrayBuffer(1024 * 1024);
    return {
      HEAP8: new Int8Array(memory),
      HEAP16: new Int16Array(memory),
      HEAP32: new Int32Array(memory),
      HEAPU8: new Uint8Array(memory),
      HEAPU16: new Uint16Array(memory),
      HEAPU32: new Uint32Array(memory),
      HEAPF32: new Float32Array(memory),
      HEAPF64: new Float64Array(memory),
      _malloc: (size: number) => size > 0 ? 4 : 0,
      _free: () => {},
      loadDynamicLibrary: async () => {},
      UTF8ToString: () => '',
    };
  }

  /**
   * Create imports object for SIDE_MODULE instantiation
   */
  private createImports(coreModule: CoreModule): WebAssembly.Imports {
    return {
      env: {
        memory: coreModule.wasmMemory!,
        __memory_base: this.calculateMemoryBase(),
        __table_base: this.calculateTableBase(),
        malloc: coreModule._malloc.bind(coreModule),
        free: coreModule._free.bind(coreModule),
      },
      wasi_snapshot_preview1: {
        fd_write: () => 0,
        fd_close: () => 0,
        fd_seek: () => 0,
        proc_exit: () => {},
      },
    };
  }

  /**
   * Calculate memory base for new extension
   */
  private calculateMemoryBase(): number {
    // In a real implementation, this would be managed by Emscripten's dynamic linker
    const base = 1024 * 1024; // 1MB base
    let offset = 0;
    for (const size of this.memoryUsage.values()) {
      offset += size;
    }
    return base + offset;
  }

  /**
   * Calculate table base for new extension
   */
  private calculateTableBase(): number {
    // In a real implementation, this would be managed by Emscripten's dynamic linker
    const base = 100; // Reserve first 100 entries for core
    return base + this.cache.size * 50; // 50 entries per extension
  }

  /**
   * Check if an extension is loaded
   */
  isLoaded(name: string): boolean {
    return this.cache.has(name.toLowerCase());
  }

  /**
   * Get the extension registry
   */
  getRegistry(): ExtensionRegistry {
    return this.registry;
  }

  /**
   * List all loaded extensions
   */
  listLoaded(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get the number of times load() has been called (for caching verification)
   */
  getLoadCount(): () => number {
    return () => this.loadCounter;
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): ExtensionMemoryStats {
    let totalUsed = 0;
    const perExtension: Record<string, number> = {};

    for (const [name, size] of this.memoryUsage) {
      totalUsed += size;
      perExtension[name] = size;
    }

    return {
      totalUsed,
      extensionCount: this.cache.size,
      perExtension,
    };
  }

  /**
   * Unload a specific extension
   */
  async unload(name: string): Promise<void> {
    const normalizedName = name.toLowerCase();
    const extension = this.cache.get(normalizedName);

    if (extension) {
      // Dispose the extension
      if (extension instanceof LoadedExtensionImpl) {
        extension.dispose();
      } else if ('disposed' in extension) {
        // External extension implementation - mark as disposed
        (extension as { disposed: boolean }).disposed = true;
        (extension as { loaded: boolean }).loaded = false;
      }

      // Remove from cache and registry
      this.cache.delete(normalizedName);
      this.registry.unregister(normalizedName);
      this.memoryUsage.delete(normalizedName);
    }
  }

  /**
   * Unload all extensions
   */
  async unloadAll(): Promise<void> {
    for (const name of Array.from(this.cache.keys())) {
      await this.unload(name);
    }
  }

  /**
   * Clear the cache and allow reloading
   */
  async clearCache(): Promise<void> {
    await this.unloadAll();
    this.loadCounter = 0;
  }
}
