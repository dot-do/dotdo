/**
 * orchestrator.ts - Multi-Module WASM Orchestrator
 *
 * This JavaScript/TypeScript bridge manages multiple independent WASM modules,
 * loading them on demand and coordinating data flow between them.
 *
 * Architecture:
 *   - core.wasm: Always loaded, handles SQL parsing
 *   - format-json.wasm: Lazily loaded when JSON format is requested
 *
 * Key challenges solved:
 *   1. Lazy loading of modules
 *   2. Data transfer between module memories (with copy overhead)
 *   3. Module lifecycle management
 *   4. Error propagation across modules
 */

// ============================================================================
// Types
// ============================================================================

/** WASM module instance with exported functions */
interface WasmModule {
  instance: WebAssembly.Instance;
  memory: WebAssembly.Memory;
  exports: WasmExports;
}

/** Common WASM exports */
interface WasmExports {
  memory: WebAssembly.Memory;
  malloc: (size: number) => number;
  free: (ptr: number) => void;
  [key: string]: unknown;
}

/** Core module specific exports */
interface CoreExports extends WasmExports {
  parse_sql: (sqlPtr: number) => number;
  get_required_format: () => number;
  get_query_type: () => number;
  get_table_name: () => number;
  get_format: () => number;
  get_column_count: () => number;
  get_column: (index: number) => number;
  get_limit: () => number;
  get_offset: () => number;
  get_error: () => number;
  allocate_result_buffer: (size: number) => number;
  get_result_buffer: () => number;
  get_result_buffer_size: () => number;
  coordinate_result: (dataPtr: number, size: number) => number;
  core_version: () => number;
  core_info: () => number;
}

/** JSON format module specific exports */
interface JsonFormatExports extends WasmExports {
  format_as_json: (dataPtr: number, size: number) => number;
  format_as_json_each_row: (dataPtr: number, size: number) => number;
  format_as_json_compact: (dataPtr: number, size: number) => number;
  parse_json: (jsonPtr: number, len: number) => number;
  get_output_buffer: () => number;
  get_output_size: () => number;
  get_error: () => number;
  json_version: () => number;
  json_info: () => number;
}

/** Query result from parsing */
interface ParsedQuery {
  type: string;
  tableName: string;
  format: string;
  columns: string[];
  limit: number;
  offset: number;
  requiredFormat: string;
}

/** Module loading metrics */
interface LoadMetrics {
  moduleName: string;
  loadTimeMs: number;
  compiledSizeBytes: number;
  instantiatedSizeBytes: number;
}

/** Benchmark result */
interface BenchmarkResult {
  operation: string;
  iterations: number;
  totalTimeMs: number;
  avgTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  throughputOpsPerSec: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Read a null-terminated string from WASM memory
 */
function readCString(memory: WebAssembly.Memory, ptr: number): string {
  const view = new Uint8Array(memory.buffer);
  let end = ptr;
  while (view[end] !== 0) end++;
  return new TextDecoder().decode(view.subarray(ptr, end));
}

/**
 * Write a null-terminated string to WASM memory
 * Returns the number of bytes written (including null terminator)
 */
function writeCString(
  memory: WebAssembly.Memory,
  ptr: number,
  str: string
): number {
  const encoded = new TextEncoder().encode(str);
  const view = new Uint8Array(memory.buffer);
  view.set(encoded, ptr);
  view[ptr + encoded.length] = 0;
  return encoded.length + 1;
}

/**
 * Copy data between two WASM module memories via JavaScript
 * This is the "bridge" that handles data transfer with copy overhead
 */
function copyBetweenModules(
  srcMemory: WebAssembly.Memory,
  srcPtr: number,
  srcSize: number,
  dstMemory: WebAssembly.Memory,
  dstPtr: number
): void {
  const srcView = new Uint8Array(srcMemory.buffer, srcPtr, srcSize);
  const dstView = new Uint8Array(dstMemory.buffer, dstPtr, srcSize);
  dstView.set(srcView);
}

// ============================================================================
// Multi-Module Orchestrator
// ============================================================================

export class MultiModuleOrchestrator {
  private coreModule: WasmModule | null = null;
  private formatModules: Map<string, WasmModule> = new Map();
  private loadMetrics: LoadMetrics[] = [];
  private wasmBasePath: string;

  constructor(wasmBasePath: string = "./") {
    this.wasmBasePath = wasmBasePath;
  }

  // ==========================================================================
  // Module Loading
  // ==========================================================================

  /**
   * Load and instantiate a WASM module
   */
  private async loadModule(
    name: string,
    wasmUrl: string
  ): Promise<WasmModule> {
    const startTime = performance.now();

    // Fetch the WASM binary
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${wasmUrl}: ${response.status}`);
    }
    const wasmBytes = await response.arrayBuffer();
    const compiledSize = wasmBytes.byteLength;

    // Compile and instantiate
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const memory = new WebAssembly.Memory({ initial: 256, maximum: 512 });

    const instance = await WebAssembly.instantiate(wasmModule, {
      env: {
        memory,
        // Minimal imports for standalone modules
        emscripten_resize_heap: () => false,
        emscripten_memcpy_js: (dest: number, src: number, num: number) => {
          const view = new Uint8Array(memory.buffer);
          view.copyWithin(dest, src, src + num);
        },
      },
      wasi_snapshot_preview1: {
        // Minimal WASI stubs
        fd_write: () => 0,
        fd_seek: () => 0,
        fd_close: () => 0,
        proc_exit: () => {},
      },
    });

    const loadTime = performance.now() - startTime;
    const instantiatedSize = memory.buffer.byteLength;

    this.loadMetrics.push({
      moduleName: name,
      loadTimeMs: loadTime,
      compiledSizeBytes: compiledSize,
      instantiatedSizeBytes: instantiatedSize,
    });

    console.log(
      `[Orchestrator] Loaded ${name}: ${compiledSize} bytes compiled, ` +
        `${instantiatedSize} bytes memory, ${loadTime.toFixed(2)}ms`
    );

    return {
      instance,
      memory,
      exports: instance.exports as unknown as WasmExports,
    };
  }

  /**
   * Initialize the core module (must be called first)
   */
  async initialize(): Promise<void> {
    if (this.coreModule) {
      console.log("[Orchestrator] Core module already initialized");
      return;
    }

    this.coreModule = await this.loadModule(
      "core",
      `${this.wasmBasePath}core.wasm`
    );
    console.log("[Orchestrator] Initialized with core module");
  }

  /**
   * Get or load a format module (lazy loading)
   */
  private async getFormatModule(formatName: string): Promise<WasmModule> {
    // Check if already loaded
    const existing = this.formatModules.get(formatName);
    if (existing) {
      return existing;
    }

    // Load on demand
    const wasmFile =
      formatName === "json"
        ? "format-json.wasm"
        : `format-${formatName}.wasm`;

    const module = await this.loadModule(
      `format-${formatName}`,
      `${this.wasmBasePath}${wasmFile}`
    );

    this.formatModules.set(formatName, module);
    return module;
  }

  // ==========================================================================
  // Query Execution
  // ==========================================================================

  /**
   * Parse a SQL query and determine required modules
   */
  parseQuery(sql: string): ParsedQuery {
    if (!this.coreModule) {
      throw new Error("Orchestrator not initialized");
    }

    const core = this.coreModule.exports as CoreExports;

    // Allocate memory for SQL string
    const sqlBytes = new TextEncoder().encode(sql);
    const sqlPtr = core.malloc(sqlBytes.length + 1);
    writeCString(this.coreModule.memory, sqlPtr, sql);

    try {
      // Parse the SQL
      const result = core.parse_sql(sqlPtr);
      if (result === 0) {
        const error = readCString(this.coreModule.memory, core.get_error());
        throw new Error(`SQL parse error: ${error}`);
      }

      // Extract parsed information
      const columns: string[] = [];
      const colCount = core.get_column_count();
      for (let i = 0; i < colCount; i++) {
        columns.push(
          readCString(this.coreModule.memory, core.get_column(i))
        );
      }

      return {
        type: readCString(this.coreModule.memory, core.get_query_type()),
        tableName: readCString(this.coreModule.memory, core.get_table_name()),
        format: readCString(this.coreModule.memory, core.get_format()),
        columns,
        limit: core.get_limit(),
        offset: core.get_offset(),
        requiredFormat: readCString(
          this.coreModule.memory,
          core.get_required_format()
        ),
      };
    } finally {
      core.free(sqlPtr);
    }
  }

  /**
   * Format data using the appropriate format module
   *
   * This demonstrates the cross-module data flow:
   * 1. Data starts in JavaScript (or would come from core module)
   * 2. Data is copied to format module memory
   * 3. Format module processes data
   * 4. Result is copied back to JavaScript
   */
  async formatData(
    data: Uint8Array,
    format: string
  ): Promise<Uint8Array> {
    // Determine which format handler to use
    const formatLower = format.toLowerCase();
    let formatModule: string;

    if (
      formatLower === "json" ||
      formatLower === "jsoneachrow" ||
      formatLower === "jsoncompact"
    ) {
      formatModule = "json";
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }

    // Lazy load the format module
    const module = await this.getFormatModule(formatModule);
    const exports = module.exports as JsonFormatExports;

    // Allocate memory in format module for input data
    const inputPtr = exports.malloc(data.length);

    // Copy data from JavaScript to format module memory
    // This is the "copy overhead" of the multi-module approach
    const inputView = new Uint8Array(module.memory.buffer, inputPtr, data.length);
    inputView.set(data);

    try {
      // Call the appropriate format function
      let resultSize: number;

      switch (formatLower) {
        case "json":
          resultSize = exports.format_as_json(inputPtr, data.length);
          break;
        case "jsoneachrow":
          resultSize = exports.format_as_json_each_row(inputPtr, data.length);
          break;
        case "jsoncompact":
          resultSize = exports.format_as_json_compact(inputPtr, data.length);
          break;
        default:
          throw new Error(`Unknown JSON format variant: ${format}`);
      }

      if (resultSize < 0) {
        const error = readCString(module.memory, exports.get_error());
        throw new Error(`Format error: ${error}`);
      }

      // Get output buffer from format module
      const outputPtr = exports.get_output_buffer();
      const outputSize = exports.get_output_size();

      // Copy result back to JavaScript
      const result = new Uint8Array(outputSize);
      result.set(new Uint8Array(module.memory.buffer, outputPtr, outputSize));

      return result;
    } finally {
      exports.free(inputPtr);
    }
  }

  /**
   * Execute a full query (parse + execute + format)
   *
   * This is a simplified flow showing how modules coordinate:
   * 1. core.wasm parses SQL
   * 2. Orchestrator determines which format module is needed
   * 3. Data is processed (would involve execution engine)
   * 4. Format module formats the output
   */
  async executeQuery(
    sql: string,
    mockData?: Uint8Array
  ): Promise<{ result: string; metrics: Record<string, number> }> {
    const metrics: Record<string, number> = {};

    // Step 1: Parse SQL
    const parseStart = performance.now();
    const parsed = this.parseQuery(sql);
    metrics.parseTimeMs = performance.now() - parseStart;

    console.log(
      `[Orchestrator] Parsed query: type=${parsed.type}, ` +
        `format=${parsed.format}, requiredModule=${parsed.requiredFormat}`
    );

    // Step 2: Would execute query here (using mock data for spike)
    if (!mockData) {
      // Create sample binary data for 3 rows, 2 columns
      mockData = this.createSampleData();
    }

    // Step 3: Format output if needed
    if (parsed.requiredFormat !== "none") {
      const formatStart = performance.now();
      const formatted = await this.formatData(mockData, parsed.format);
      metrics.formatTimeMs = performance.now() - formatStart;
      metrics.dataSizeBytes = mockData.length;
      metrics.formattedSizeBytes = formatted.length;

      return {
        result: new TextDecoder().decode(formatted),
        metrics,
      };
    }

    // Default: return raw data as string
    return {
      result: new TextDecoder().decode(mockData),
      metrics,
    };
  }

  // ==========================================================================
  // Data Helpers
  // ==========================================================================

  /**
   * Create sample binary data for testing
   *
   * Format:
   *   uint32: column count
   *   For each column: uint32 name_len, char* name
   *   uint32: row count
   *   For each row, for each column:
   *     uint8: value type
   *     value data
   */
  createSampleData(): Uint8Array {
    const buffer = new ArrayBuffer(1024);
    const view = new DataView(buffer);
    const uint8View = new Uint8Array(buffer);
    let offset = 0;

    // Column count: 2
    view.setUint32(offset, 2, true);
    offset += 4;

    // Column 1: "id"
    const col1 = new TextEncoder().encode("id");
    view.setUint32(offset, col1.length, true);
    offset += 4;
    uint8View.set(col1, offset);
    offset += col1.length;

    // Column 2: "name"
    const col2 = new TextEncoder().encode("name");
    view.setUint32(offset, col2.length, true);
    offset += 4;
    uint8View.set(col2, offset);
    offset += col2.length;

    // Row count: 3
    view.setUint32(offset, 3, true);
    offset += 4;

    // Row 1: id=1, name="Alice"
    uint8View[offset++] = 1; // Int type
    view.setBigInt64(offset, BigInt(1), true);
    offset += 8;
    uint8View[offset++] = 3; // String type
    const name1 = new TextEncoder().encode("Alice");
    view.setUint32(offset, name1.length, true);
    offset += 4;
    uint8View.set(name1, offset);
    offset += name1.length;

    // Row 2: id=2, name="Bob"
    uint8View[offset++] = 1;
    view.setBigInt64(offset, BigInt(2), true);
    offset += 8;
    uint8View[offset++] = 3;
    const name2 = new TextEncoder().encode("Bob");
    view.setUint32(offset, name2.length, true);
    offset += 4;
    uint8View.set(name2, offset);
    offset += name2.length;

    // Row 3: id=3, name="Charlie"
    uint8View[offset++] = 1;
    view.setBigInt64(offset, BigInt(3), true);
    offset += 8;
    uint8View[offset++] = 3;
    const name3 = new TextEncoder().encode("Charlie");
    view.setUint32(offset, name3.length, true);
    offset += 4;
    uint8View.set(name3, offset);
    offset += name3.length;

    return uint8View.subarray(0, offset);
  }

  // ==========================================================================
  // Benchmarking
  // ==========================================================================

  /**
   * Benchmark data copy overhead between modules
   */
  async benchmarkCopyOverhead(
    dataSizeKB: number,
    iterations: number
  ): Promise<BenchmarkResult> {
    // Ensure format module is loaded
    await this.getFormatModule("json");
    const jsonModule = this.formatModules.get("json")!;
    const jsonExports = jsonModule.exports as JsonFormatExports;

    // Create test data
    const data = new Uint8Array(dataSizeKB * 1024);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 256;
    }

    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();

      // Allocate in WASM
      const ptr = jsonExports.malloc(data.length);

      // Copy JS -> WASM
      const wasmView = new Uint8Array(
        jsonModule.memory.buffer,
        ptr,
        data.length
      );
      wasmView.set(data);

      // Copy WASM -> JS
      const result = new Uint8Array(data.length);
      result.set(wasmView);

      // Free
      jsonExports.free(ptr);

      times.push(performance.now() - start);
    }

    const totalTime = times.reduce((a, b) => a + b, 0);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    return {
      operation: `copy ${dataSizeKB}KB JS<->WASM`,
      iterations,
      totalTimeMs: totalTime,
      avgTimeMs: totalTime / iterations,
      minTimeMs: minTime,
      maxTimeMs: maxTime,
      throughputOpsPerSec: (iterations / totalTime) * 1000,
    };
  }

  /**
   * Benchmark lazy module loading
   */
  async benchmarkLazyLoading(iterations: number): Promise<BenchmarkResult> {
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      // Clear cached module to force reload
      this.formatModules.delete("json");

      const start = performance.now();
      await this.getFormatModule("json");
      times.push(performance.now() - start);
    }

    const totalTime = times.reduce((a, b) => a + b, 0);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    return {
      operation: "lazy load format-json module",
      iterations,
      totalTimeMs: totalTime,
      avgTimeMs: totalTime / iterations,
      minTimeMs: minTime,
      maxTimeMs: maxTime,
      throughputOpsPerSec: (iterations / totalTime) * 1000,
    };
  }

  /**
   * Get all loading metrics
   */
  getLoadMetrics(): LoadMetrics[] {
    return [...this.loadMetrics];
  }

  /**
   * Get module info
   */
  getModuleInfo(): Record<string, string> {
    const info: Record<string, string> = {};

    if (this.coreModule) {
      const core = this.coreModule.exports as CoreExports;
      info.coreVersion = readCString(
        this.coreModule.memory,
        core.core_version()
      );
      info.coreInfo = readCString(this.coreModule.memory, core.core_info());
    }

    for (const [name, module] of this.formatModules) {
      if (name === "json") {
        const json = module.exports as JsonFormatExports;
        info[`${name}Version`] = readCString(
          module.memory,
          json.json_version()
        );
        info[`${name}Info`] = readCString(module.memory, json.json_info());
      }
    }

    return info;
  }
}

// ============================================================================
// Example Usage / CLI
// ============================================================================

/**
 * Run example demonstrating multi-module architecture
 */
export async function runExample(): Promise<void> {
  console.log("=== Multi-Module WASM Architecture Demo ===\n");

  const orchestrator = new MultiModuleOrchestrator("./build/");

  // Initialize core module
  console.log("1. Initializing core module...");
  await orchestrator.initialize();

  // Parse a query
  console.log("\n2. Parsing SQL query...");
  const query = "SELECT id, name FROM users FORMAT JSON";
  const parsed = orchestrator.parseQuery(query);
  console.log("Parsed:", parsed);

  // Execute with JSON format (will lazy load format-json module)
  console.log("\n3. Executing query with JSON format...");
  const { result, metrics } = await orchestrator.executeQuery(query);
  console.log("Result:", result);
  console.log("Metrics:", metrics);

  // Show module info
  console.log("\n4. Module info:");
  console.log(orchestrator.getModuleInfo());

  // Benchmark copy overhead
  console.log("\n5. Benchmarking copy overhead...");
  const copyBench = await orchestrator.benchmarkCopyOverhead(100, 100);
  console.log(copyBench);

  // Show all load metrics
  console.log("\n6. Load metrics:");
  console.log(orchestrator.getLoadMetrics());
}

// Export for testing
export { readCString, writeCString, copyBetweenModules };
