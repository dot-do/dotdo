# Emscripten Dynamic Linking for ClickHouse WASM

This directory contains research and proof-of-concept for using Emscripten's `MAIN_MODULE` and `SIDE_MODULE` dynamic linking to create a modular architecture for the **real ClickHouse WASM binary**.

## Context

This project compiles **actual ClickHouse C++ code** (from `vendor/chdb`) to WebAssembly. This spike explores whether we can split the compiled ClickHouse binary into dynamically-linked modules for:

- Smaller initial download size (load only what's needed)
- Plugin/extension architecture for ClickHouse features
- Shared memory and function calls across modules

## Goal

Determine if we can have a core ClickHouse WASM module that dynamically loads extension modules (formats, table engines, functions) at runtime.

## Key Findings

### 1. Can SIDE_MODULEs share memory with MAIN_MODULE?

**YES.** All modules in a dynamically linked program share:
- **WebAssembly.Memory** - Single memory instance (`env.memory`)
- **WebAssembly.Table** - Single indirect function table (`env.__indirect_function_table`)
- **Stack pointer** - Shared `__stack_pointer` global

Memory sharing is automatic through Emscripten's loader. The side module receives base offsets:
- `__memory_base` - Where this module's data segment starts
- `__table_base` - Where this module's function entries start

### 2. What's the overhead of dynamic linking?

**Moderate, but improved significantly in recent Emscripten versions.**

| Aspect | Static Linking | Dynamic Linking | Notes |
|--------|---------------|-----------------|-------|
| Code size (main module) | Optimal | +5-15% | Dead code elimination less effective |
| Code size (total) | Baseline | Similar or larger | Depends on extension usage |
| Startup time | Faster | Slower | Additional module loading |
| Cross-module calls | N/A | ~5-10% slower | Function table indirection |
| Memory overhead | Optimal | Minimal | Shared memory, no duplication |

**Recent improvements (Oct 2025):** Main module no longer requires position-independent code (`-pie`), eliminating most runtime relocations from the core module.

### 3. Can we call functions across module boundaries?

**YES.** Two approaches:

1. **Direct imports** - Side module declares `extern` functions that resolve to main module exports
2. **dlopen/dlsym** - Runtime lookup of symbols by name

```cpp
// In extension.cpp (SIDE_MODULE)
extern "C" {
    void core_log(const char* message);  // Resolved from MAIN_MODULE
}

void extension_function() {
    core_log("Called from extension!");  // Works!
}
```

### 4. How do we handle Emscripten's runtime (malloc, etc)?

**The MAIN_MODULE includes all system libraries.** Side modules:
- Do NOT include libc, libcxx, or Emscripten runtime
- Import these functions from the main module
- Must use `core_alloc`/`core_free` or import `malloc`/`free` explicitly

```cpp
// Main module must export malloc/free
-sEXPORTED_FUNCTIONS=[...,_malloc,_free]

// Side module can then use them
void* ptr = malloc(100);  // Works - resolved from main module
```

### 5. Size overhead of MAIN_MODULE vs static linking?

| Build | Size | Notes |
|-------|------|-------|
| Static single module | Baseline | Optimal dead code elimination |
| MAIN_MODULE=1 | +50-100% | All system libs included, no DCE |
| MAIN_MODULE=2 | +10-20% | DCE enabled, must explicitly export symbols |
| SIDE_MODULE=2 | Very small | No system libs, just user code |

**Recommendation:** Always use `MAIN_MODULE=2` and `SIDE_MODULE=2` for production.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    JavaScript Host                           │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │               Emscripten Loader (core.js)             │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                 │
│                            ▼                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │          Shared WebAssembly.Memory                    │   │
│  │          Shared WebAssembly.Table                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                 │
│         ┌──────────────────┼──────────────────┐             │
│         ▼                  ▼                  ▼             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ core.wasm   │    │ ext1.wasm   │    │ ext2.wasm   │     │
│  │ MAIN_MODULE │<───│ SIDE_MODULE │    │ SIDE_MODULE │     │
│  │             │    │             │    │             │     │
│  │ - libc      │    │ - imports   │    │ - imports   │     │
│  │ - runtime   │    │   malloc    │    │   malloc    │     │
│  │ - malloc    │    │   core_*    │    │   core_*    │     │
│  │ - core_*    │    │             │    │             │     │
│  │ exports     │    │ - exports   │    │ - exports   │     │
│  └─────────────┘    │   ext1_*    │    │   ext2_*    │     │
│                     └─────────────┘    └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
wasm/dynamic/
├── README.md           # This file
├── core.cpp            # Main module source (MAIN_MODULE)
├── extension.cpp       # Sample extension (SIDE_MODULE)
├── CMakeLists.txt      # CMake build configuration
├── build.sh            # Simple build script
├── loader.js           # JavaScript dynamic loader
└── test.html           # Browser test page
```

## Building

### Prerequisites

- Emscripten SDK (emsdk) installed and activated
- CMake 3.16+ (for CMake build)

### Using build.sh (Recommended)

```bash
cd wasm/dynamic
./build.sh           # Build both modules
./build.sh debug     # Build with debug info
./build.sh clean     # Clean build artifacts
```

### Using CMake

```bash
mkdir build && cd build
emcmake cmake ..
emmake make
```

### Manual Build

```bash
# Core module (MAIN_MODULE)
emcc core.cpp \
    -sMAIN_MODULE=2 \
    -sEXPORTED_FUNCTIONS=[_main,_core_init,...] \
    -sEXPORTED_RUNTIME_METHODS=[ccall,cwrap,loadDynamicLibrary] \
    -sALLOW_TABLE_GROWTH=1 \
    -sMODULARIZE=1 \
    -O2 \
    -o core.js

# Extension module (SIDE_MODULE)
emcc extension.cpp \
    -sSIDE_MODULE=2 \
    -sEXPORTED_FUNCTIONS=[_extension_init,...] \
    -O2 \
    -o extension.wasm
```

## Testing

### Browser

```bash
cd wasm/dynamic/build
cp ../loader.js ../test.html .
python3 -m http.server 8080
# Open http://localhost:8080/test.html
```

### Node.js

```bash
cd wasm/dynamic/build
cp ../loader.js .
node loader.js
```

## API Reference

### Core Module Functions

| Function | Description |
|----------|-------------|
| `core_init()` | Initialize the core module |
| `core_get_version()` | Get core version number |
| `core_alloc(size)` | Allocate memory |
| `core_free(ptr)` | Free memory |
| `core_log(message)` | Log a message |
| `core_set_error(error)` | Set error message |
| `core_get_error()` | Get last error |
| `core_register_extension(name)` | Register a loaded extension |

### Extension Module Functions

| Function | Description |
|----------|-------------|
| `extension_init()` | Initialize the extension |
| `extension_factorial(n)` | Compute n! |
| `extension_fibonacci(n)` | Compute Fibonacci(n) |
| `extension_power(base, exp)` | Compute base^exp |
| `extension_is_prime(n)` | Check if n is prime |
| `extension_sum_array(arr, len)` | Sum array elements |

## Limitations and Caveats

### 1. Chromium 8MB Limit

Chromium does not support synchronous compilation of WASM modules over 8MB on the main thread. For large modules:
- Use `emscripten_dlopen()` (async)
- Compile in a Web Worker
- Use streaming compilation

### 2. Threading (pthreads)

Dynamic linking with pthreads is experimental:
- Function table updates require mutex synchronization
- `dlopen` blocks until all threads are synced
- Potential deadlocks if not careful

### 3. EM_ASM and EM_JS

Using `EM_ASM` or `EM_JS` in side modules requires:
- `eval` support enabled
- Conflicts with `-sDYNAMIC_EXECUTION=0`

### 4. Symbol Resolution

All symbols imported by side modules must be:
- Exported by the main module explicitly
- Or resolved through `dlsym()` at runtime

### 5. No Lazy Loading of System Libraries

The main module must include all system libraries upfront. You cannot:
- Defer libc loading
- Load different libc implementations

## Recommendations for ClickHouse WASM

### Recommended Architecture

```
chdb-core.wasm (MAIN_MODULE) - Real ClickHouse Core
├── SQL parser (actual ClickHouse parser)
├── Query executor (actual ClickHouse executor)
├── Memory management
├── VFS layer
└── Extension registry

chdb-parquet.wasm (SIDE_MODULE) - Real ClickHouse Parquet
├── Parquet format handler (actual ClickHouse implementation)
├── Arrow integration
└── Imports: core memory, VFS

chdb-json.wasm (SIDE_MODULE) - Real ClickHouse JSON
├── JSON format handler (actual ClickHouse implementation)
├── JSONPath
└── Imports: core memory

chdb-http.wasm (SIDE_MODULE) - Real ClickHouse HTTP
├── HTTP table functions (actual ClickHouse implementation)
├── URL parsing
└── Imports: core memory, async I/O
```

### Benefits

1. **Smaller Initial Load** - Users only download what they need
2. **Faster Startup** - Core module loads first, extensions on demand
3. **Modularity** - Clear boundaries between ClickHouse components
4. **Upgradability** - Update extensions without updating core

### Risks

1. **Complexity** - Build system more complicated
2. **Performance** - Cross-module calls slightly slower
3. **Debugging** - Source maps need coordination
4. **Size** - Total size may be larger than single optimized build

### Verdict

**VIABLE for ClickHouse WASM, but start simple:**

1. Start with a monolithic build of real ClickHouse
2. Profile and identify natural module boundaries
3. Extract expensive/optional features as side modules
4. Measure real-world performance impact

## References

- [Emscripten Dynamic Linking Documentation](https://emscripten.org/docs/compiling/Dynamic-Linking.html)
- [WebAssembly Tool Conventions - Dynamic Linking](https://github.com/WebAssembly/tool-conventions/blob/main/DynamicLinking.md)
- [Emscripten Settings Reference](https://emscripten.org/docs/tools_reference/settings_reference.html)
- [Emscripten Test Suite (test_dylink_*, test_dlfcn_*)](https://github.com/emscripten-core/emscripten/tree/main/test)

## Changelog

- 2026-01-21: Initial spike created
