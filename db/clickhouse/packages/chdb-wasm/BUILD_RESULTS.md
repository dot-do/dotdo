# chdb-wasm Build Attempt Results

## Summary

This document captures the results of attempting to compile chdb (ClickHouse) to WebAssembly.

**Bottom Line:** Full ClickHouse/chdb compilation to WASM is currently blocked by fundamental architecture constraints in ClickHouse's build system. However, we have successfully compiled isolated components (Parser, Lexer) that provide valuable SQL functionality.

## Build Date

Generated: 2024-01-18

## What Works

### Successfully Compiled Components

| Component | File | Size | Status |
|-----------|------|------|--------|
| SQL Lexer (standalone) | `wasm/dist/Lexer.wasm` | ~15KB | Working |
| SQL Lexer (with JS) | `wasm/dist/lexer.js` + `lexer.wasm` | ~30KB total | Working |
| SQL Parser | `wasm/dist/parser.wasm` | ~23KB | Working |
| SQL Parser (with JS) | `wasm/dist/parser.js` + `parser.wasm` | ~42KB total | Working |

### Working Features

1. **Lexical Analysis**
   - Full SQL tokenization
   - Token type identification (BareWord, Number, StringLiteral, etc.)
   - Error token detection
   - Whitespace and comment handling

2. **Token-Level Parsing**
   - Bracket/parentheses balancing
   - Token sequence validation
   - Error position reporting
   - Query structure analysis

3. **JavaScript API**
   ```javascript
   const parser = await createParserModule();
   const tokens = parser.tokenize("SELECT * FROM users WHERE id > 10");
   const isValid = parser.validate();
   ```

## What Blocks Full Compilation

### 1. Build System Architecture Check (FATAL)

ClickHouse's CMake explicitly rejects WASM:

**File: `/vendor/chdb/cmake/arch.cmake` (lines 16-17)**
```cmake
else ()
    message (FATAL_ERROR "Platform ${CMAKE_SYSTEM_PROCESSOR} is not supported")
endif ()
```

Supported architectures:
- x86_64/amd64
- aarch64/arm64
- powerpc64le
- s390x
- riscv64
- loongarch64

**NOT supported:** wasm32, wasm64, Emscripten

**File: `/vendor/chdb/cmake/target.cmake` (lines 20-22)**
```cmake
else ()
    message (FATAL_ERROR "Platform ${CMAKE_SYSTEM_NAME} is not supported")
endif ()
```

Supported systems:
- Linux
- Android
- FreeBSD
- Darwin (macOS)
- SunOS

**NOT supported:** Emscripten, WASM

### 2. Threading Requirements

ClickHouse heavily depends on native threading:

```cpp
// Common patterns throughout codebase
ThreadPool pool(max_threads);
std::thread worker([&]() { ... });
std::mutex lock;
std::condition_variable cv;
```

**WASM Threading Limitations:**
- Requires SharedArrayBuffer
- Needs COOP/COEP HTTP headers
- Limited browser support
- Performance significantly worse than native

### 3. System Call Dependencies

ClickHouse uses many POSIX system calls unavailable in WASM:

| Category | Functions | WASM Alternative |
|----------|-----------|------------------|
| File I/O | `open`, `read`, `write`, `mmap` | Emscripten VFS (limited) |
| Network | `socket`, `connect`, `bind` | Not available |
| Process | `fork`, `exec`, `signal` | Not available |
| Memory | `mmap`, `mprotect` | WASM memory model |

### 4. Memory Architecture

- ClickHouse assumes 64-bit pointers (8 bytes)
- WASM32 uses 32-bit pointers (4 bytes)
- Default address space assumptions don't fit WASM model
- Memory-mapped file operations (MergeTree) incompatible

### 5. CPU Feature Detection

ClickHouse auto-detects and uses CPU features:
- AVX/AVX2/AVX512 SIMD instructions
- BMI2 bit manipulation
- POPCNT, LZCNT instructions

WASM has:
- SIMD128 (fixed 128-bit vectors only)
- No dynamic feature detection
- Different instruction set entirely

## Detailed Error Analysis

### CMake Configuration Error

```
-- The ASM compiler identification is unknown
-- Found assembler: /Users/nathanclevenger/emsdk/upstream/emscripten/emcc
CMake Error at cmake/arch.cmake:17 (message):
  Platform x86 is not supported
Call Stack (most recent call first):
  CMakeLists.txt:19 (include)
```

**Root Cause:** CMake's `CMAKE_SYSTEM_PROCESSOR` reports incorrectly when using Emscripten toolchain. The arch.cmake file doesn't handle the WASM case.

### Would-Be Issues If Arch Check Were Patched

Even if we patched arch.cmake to accept WASM, we would hit:

1. **contrib/CMakeLists.txt** - Many contrib libraries have their own platform checks
2. **base/glibc-compatibility** - Assumes glibc, not Emscripten libc
3. **src/Common/ThreadPool.h** - pthread requirements
4. **src/IO/** - Heavy use of syscalls
5. **src/Storages/MergeTree/** - Memory-mapped files

## Recommendations

### Immediate Use (Working Now)

1. **Use Parser.wasm for SQL tooling:**
   - Syntax highlighting in web editors
   - Query validation before sending to server
   - Auto-completion based on token context
   - Query formatting/beautification

2. **Extend parser capabilities:**
   - Build AST for simple queries
   - Extract table/column names
   - Detect query type (SELECT, INSERT, etc.)

### Medium-Term Options

1. **Selective Subsystem Compilation**

   Some ClickHouse subsystems could potentially be extracted and compiled:

   | Subsystem | Feasibility | Size Estimate |
   |-----------|-------------|---------------|
   | Type System | High | ~200KB |
   | Functions (core) | Medium | ~500KB |
   | Memory Engine | Medium | ~300KB |
   | Basic Interpreter | Low | ~1MB |

2. **Stub Architecture** (Already Prepared)

   Location: `/wasm/stubs/`
   - `wasm_storage_stubs.cpp` - Stubs for unsupported storage engines
   - `wasm_function_stubs.cpp` - Stubs for heavy functions
   - `wasm_format_stubs.cpp` - Stubs for binary formats

### Long-Term Approaches

1. **Upstream WASM Support**

   Would require ClickHouse team to:
   - Add WASM to arch.cmake and target.cmake
   - Create WASM-specific code paths
   - Implement async alternatives to threading
   - Use Emscripten VFS abstraction

   **Likelihood:** Very low - not a priority for ClickHouse team

2. **Alternative: WASM SQL Engine**

   Consider well-established WASM SQL options:
   - **sql.js** (SQLite to WASM) - mature, ~1MB
   - **DuckDB WASM** - analytical queries, ~10MB
   - Add ClickHouse SQL dialect translation layer

## File Structure Created

```
/packages/chdb-wasm/
├── wasm/
│   ├── dist/
│   │   ├── parser.wasm         # 23KB - Working SQL parser
│   │   ├── parser.js           # JS bindings
│   │   ├── Lexer.wasm          # 15KB - Standalone lexer
│   │   └── lexer.js            # JS bindings
│   ├── stubs/
│   │   ├── wasm_stubs.h        # Stub architecture header
│   │   ├── wasm_storage_stubs.cpp
│   │   ├── wasm_function_stubs.cpp
│   │   └── wasm_format_stubs.cpp
│   ├── include/                 # Standalone headers
│   ├── parser_bindings.cpp
│   ├── lexer_bindings.cpp
│   └── build.sh
├── cmake/
│   ├── wasm-minimal.cmake       # Minimal build preset (for future use)
│   ├── minimal-functions.cmake  # Function whitelist
│   └── EmscriptenToolchain.cmake
├── scripts/
│   └── build-chdb-wasm.sh       # Full build attempt script
├── logs/
│   ├── cmake_configure.log      # CMake output
│   └── cmake_flags.txt          # Flags used
└── BUILD_RESULTS.md             # This document
```

## Size Analysis

### Current Working Components
| Component | Raw | Gzipped |
|-----------|-----|---------|
| parser.wasm | 23KB | ~8KB |
| parser.js | 19KB | ~6KB |
| lexer.wasm | 15KB | ~5KB |
| lexer.js | 15KB | ~5KB |
| **Total** | **72KB** | **~24KB** |

### Estimated Full Build (If Possible)
| Configuration | Raw | Gzipped |
|---------------|-----|---------|
| Parser + AST | ~200KB | ~60KB |
| + Type System | ~500KB | ~150KB |
| + Memory Engine | ~1MB | ~300KB |
| + Core Functions | ~3MB | ~1MB |
| + Basic Interpreter | ~5MB | ~1.5MB |
| Full ClickHouse | ~100MB+ | ~30MB+ |

## Conclusion

**Full chdb WASM compilation is not feasible** with the current ClickHouse codebase architecture. The build system, threading model, and system dependencies all assume native compilation.

**However**, the working Parser and Lexer components provide immediate value for:
- SQL query validation
- Syntax highlighting
- Query analysis
- Client-side query checking

For full SQL execution in the browser, consider:
1. Using the parser for validation, then proxying to a server
2. Using sql.js or DuckDB WASM for local execution
3. Building a hybrid approach with parser locally + remote execution

## Cloudflare Workers Deployment Testing (2026-01-19)

### Full chdb WASM Build

A full chdb WASM binary was successfully compiled:

| File | Location | Size |
|------|----------|------|
| chdb.wasm | `build-wasm/dist/chdb.wasm` | 130 MB (124.2 MiB) |
| chdb.js | `build-wasm/dist/chdb.js` | 63 KB |

### Cloudflare Workers Static Assets Limitation

**BLOCKER:** Cloudflare Workers Static Assets have a **25 MiB per-file limit** that cannot be exceeded.

| Metric | Value |
|--------|-------|
| Cloudflare Static Assets Limit | 25 MiB |
| chdb.wasm Size | 124.2 MiB |
| Exceeds Limit By | 497% (5.0x) |

This limitation applies to all Cloudflare plans (Free and Paid).

Source: [Cloudflare Workers Platform Limits](https://developers.cloudflare.com/workers/platform/limits/)

### Alternatives for Large WASM Files

| Approach | Description | Recommended |
|----------|-------------|-------------|
| **R2 Storage** | Store WASM in Cloudflare R2 (up to 5GB per object) | **Yes** |
| External CDN | Serve from jsDelivr, unpkg, or GitHub Releases | Partial |
| Chunked WASM | Split into multiple <25MB files | Complex |
| Streaming Compilation | Use `WebAssembly.instantiateStreaming` with external URL | Partial |

### R2 Storage Solution

The recommended approach is to use Cloudflare R2 storage:

1. Create an R2 bucket
2. Upload `chdb.wasm` to the bucket
3. Configure Worker with R2 binding:

```toml
# wrangler.toml
[[r2_buckets]]
binding = "WASM_BUCKET"
bucket_name = "chdb-wasm"
```

4. Serve WASM from R2 in the Worker:

```typescript
const object = await env.WASM_BUCKET.get('chdb.wasm');
const wasmBinary = await object.arrayBuffer();
const module = await WebAssembly.compile(wasmBinary);
```

### DuckDB WASM Also Affected

Note: Even DuckDB WASM files (33-38MB) exceed the 25MB Static Assets limit:

| File | Size | Exceeds Limit |
|------|------|---------------|
| duckdb-eh.wasm | 33 MB | Yes |
| duckdb-mvp.wasm | 38 MB | Yes |

The current chdb-wasm worker uses DuckDB loaded from a CDN (jsdelivr) to avoid this limitation.

### Next Steps for chdb WASM Deployment

1. **Create R2 bucket** for WASM storage
2. **Upload chdb.wasm** to R2
3. **Update Worker** to load WASM from R2
4. **Implement initialization** using the chdb.js glue code
5. **Test query execution** with chdb WASM

## References

- ClickHouse GitHub: https://github.com/ClickHouse/ClickHouse
- chdb GitHub: https://github.com/chdb-io/chdb
- Emscripten Docs: https://emscripten.org/docs/
- WASM Spec: https://webassembly.org/specs/
- sql.js: https://github.com/sql-js/sql.js
- DuckDB WASM: https://duckdb.org/docs/api/wasm
- Cloudflare Workers Limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare R2: https://developers.cloudflare.com/r2/
