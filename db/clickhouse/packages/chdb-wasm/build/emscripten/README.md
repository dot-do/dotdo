# chdb-wasm Emscripten Build Configuration

This directory contains the CMake build configuration for compiling vendor/chdb to WebAssembly using Emscripten, targeting Cloudflare Workers.

## Quick Start

```bash
# Install Emscripten (if not already installed)
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest
source ./emsdk_env.sh
cd ..

# Build
./build.sh minimal    # Smallest binary (~5-10MB)
./build.sh standard   # Balanced (~15-25MB)
./build.sh full       # All features (~50MB+)
```

## Target Environment

The build is configured for **Cloudflare Workers** with these constraints:

| Constraint | Value | Configuration |
|------------|-------|---------------|
| Memory Limit | 128MB | `MAXIMUM_MEMORY=134217728` |
| Threading | Single-threaded | No pthreads |
| Filesystem | None | `NO_FILESYSTEM=1`, use R2/KV |
| Output | WASM only | `WASM=1` (not asm.js) |

## Build Profiles

### `minimal` (Recommended for Workers)
- **Target Size**: ~5-10MB uncompressed, ~2-3MB gzipped
- **Features**: Parser, Lexer, Memory engine, JSON/CSV formats
- **Use Case**: Simple analytics, SQL validation

### `standard`
- **Target Size**: ~15-25MB uncompressed, ~5-8MB gzipped
- **Features**: + MergeTree engine, Parquet format, date/time functions
- **Use Case**: Typical OLAP workloads

### `full`
- **Target Size**: ~50MB+ uncompressed
- **Features**: All WASM-compatible ClickHouse features
- **Use Case**: Maximum compatibility

## Files

| File | Purpose |
|------|---------|
| `CMakeLists.txt` | Main CMake configuration for the WASM build |
| `toolchain.cmake` | Emscripten cross-compilation toolchain |
| `build.sh` | Build automation script |
| `README.md` | This documentation |

## Build Process

### Using build.sh (Recommended)

```bash
# Basic build
./build.sh

# With options
./build.sh --clean minimal       # Clean rebuild
./build.sh -j 8 standard         # 8 parallel jobs
./build.sh --verbose full        # Verbose output
./build.sh --check               # Check prerequisites only
```

### Using CMake Directly

```bash
# Create build directory
mkdir -p ../../build-emscripten && cd ../../build-emscripten

# Configure with emcmake
emcmake cmake -S ../build/emscripten -B . \
  -DCMAKE_BUILD_TYPE=Release \
  -DCHDB_PROFILE=minimal

# Build
cmake --build . --parallel

# Output in dist/
ls dist/chdb.{js,wasm}
```

## Configuration Details

### Compiler Flags (Size Optimization)

```
-Oz                  # Aggressive size optimization
-flto                # Link-time optimization
-fno-exceptions      # No C++ exceptions (big savings)
-fno-rtti            # No runtime type information
-fvisibility=hidden  # Hide symbols by default
-ffunction-sections  # Enable dead code elimination
-fdata-sections      # Enable unused data elimination
```

### WASM Features Enabled

```
-msimd128                 # SIMD128 (Workers compatible)
-mbulk-memory             # Bulk memory operations
-mnontrapping-fptoint     # Non-trapping float-to-int
-msign-ext                # Sign extension operations
```

### Linker Flags

```
-sALLOW_MEMORY_GROWTH=1   # Memory can grow up to 128MB
-sINITIAL_MEMORY=16MB     # Start with 16MB
-sMAXIMUM_MEMORY=128MB    # Cloudflare Workers limit
-sNO_FILESYSTEM=1         # No Emscripten FS
-sMALLOC=emmalloc         # Smallest allocator
-sMODULARIZE=1            # ES6 module output
--closure=1               # Minify JS glue code
```

## Exported Functions

The WASM module exports these C functions:

```c
// Lifecycle
int    chdb_wasm_init();
void   chdb_wasm_shutdown();

// Query execution
void*  chdb_wasm_query(const char* sql);
void*  chdb_wasm_query_with_format(const char* sql, const char* format);

// Result handling
void   chdb_wasm_result_free(void* result);
char*  chdb_wasm_result_data(void* result);
size_t chdb_wasm_result_length(void* result);
char*  chdb_wasm_result_error(void* result);

// Info
char*  chdb_wasm_version();
```

## Usage in JavaScript

```javascript
import createChDBModule from './dist/wasm/chdb.js';

async function main() {
  // Initialize the module
  const chdb = await createChDBModule({
    // Optional: Custom WASM binary location
    locateFile: (path) => `/wasm/${path}`
  });

  // Initialize chdb
  chdb._chdb_wasm_init();

  // Execute a query
  const resultPtr = chdb.ccall(
    'chdb_wasm_query',
    'number',
    ['string'],
    ['SELECT 1 + 1 AS result FORMAT JSON']
  );

  // Get result data
  const dataPtr = chdb._chdb_wasm_result_data(resultPtr);
  const length = chdb._chdb_wasm_result_length(resultPtr);
  const data = chdb.UTF8ToString(dataPtr, length);

  console.log(JSON.parse(data));

  // Free result
  chdb._chdb_wasm_result_free(resultPtr);

  // Shutdown when done
  chdb._chdb_wasm_shutdown();
}

main();
```

## Cloudflare Workers Integration

```javascript
// worker.js
import createChDBModule from './chdb.js';

let chdb = null;

export default {
  async fetch(request, env) {
    // Lazy initialization
    if (!chdb) {
      chdb = await createChDBModule();
      chdb._chdb_wasm_init();
    }

    const url = new URL(request.url);
    const sql = url.searchParams.get('query') || 'SELECT 1';

    const resultPtr = chdb.ccall(
      'chdb_wasm_query',
      'number',
      ['string'],
      [sql]
    );

    const errorPtr = chdb._chdb_wasm_result_error(resultPtr);
    if (errorPtr) {
      const error = chdb.UTF8ToString(errorPtr);
      chdb._chdb_wasm_result_free(resultPtr);
      return new Response(JSON.stringify({ error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const dataPtr = chdb._chdb_wasm_result_data(resultPtr);
    const length = chdb._chdb_wasm_result_length(resultPtr);
    const data = chdb.UTF8ToString(dataPtr, length);

    chdb._chdb_wasm_result_free(resultPtr);

    return new Response(data, {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

## Disabled Features

The following features are disabled for WASM/Workers compatibility:

| Category | Disabled Features |
|----------|-------------------|
| Threading | pthreads, multi-threaded execution |
| Memory | jemalloc, mimalloc (using emmalloc) |
| JIT | LLVM-based query compilation |
| Network | gRPC, HDFS, native database connectors |
| Cloud | S3/Azure/GCS SDKs (use fetch instead) |
| Formats (minimal) | Parquet, Arrow, ORC |

## Troubleshooting

### "Emscripten SDK not found"
```bash
# Ensure EMSDK is set
export EMSDK=/path/to/emsdk
source $EMSDK/emsdk_env.sh
```

### "Memory limit exceeded"
The build is configured for 128MB max. For larger data:
- Process data in chunks
- Use streaming queries
- Consider the `standard` or `full` profile

### "Build takes too long"
```bash
# Reduce parallel jobs if memory-constrained
./build.sh -j 2 minimal
```

### "wasm-opt not found"
```bash
# wasm-opt is included in emsdk
$EMSDK/upstream/bin/wasm-opt --version

# Or install binaryen
brew install binaryen  # macOS
apt install binaryen   # Debian/Ubuntu
```

## Output Structure

After a successful build:

```
packages/chdb-wasm/
├── build-emscripten/          # CMake build directory
│   ├── dist/
│   │   ├── chdb.js            # JS glue code
│   │   └── chdb.wasm          # WASM binary
│   └── ...
└── dist/
    └── wasm/
        ├── chdb.js            # Copied for deployment
        └── chdb.wasm
```

## References

- [Emscripten Documentation](https://emscripten.org/docs/)
- [Cloudflare Workers WASM](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)
- [ClickHouse chdb](https://github.com/chdb-io/chdb)
- [WebAssembly Memory](https://webassembly.org/docs/semantics/#linear-memory)
