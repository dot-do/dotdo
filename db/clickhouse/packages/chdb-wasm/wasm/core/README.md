# Core MAIN_MODULE - Real ClickHouse WASM

This directory contains the core WASM module built with Emscripten's `MAIN_MODULE=2` option, serving as the foundation for the **real ClickHouse** dynamic linking architecture.

## What This Is

This is **actual ClickHouse** - the C++ codebase from `vendor/chdb` compiled to WebAssembly. The core module contains:

- The real ClickHouse SQL parser
- The real ClickHouse query executor
- The real ClickHouse memory management
- All system libraries (libc, libcxx) for side modules

## Overview

The core module serves as the foundation for the dynamic linking architecture:

- **System Libraries**: Provides malloc, free, and other libc functions to side modules
- **VFS Layer**: Virtual File System abstraction for storage operations
- **Extension Registry**: Manages dynamically loaded extensions
- **Shared Memory**: Provides the WebAssembly.Memory that all modules share
- **Function Table**: Provides WebAssembly.Table for indirect function calls

## Architecture

```
+------------------+
|   JavaScript     |
|   (loader.js)    |
+--------+---------+
         |
         v
+------------------+
|   core.wasm      |  <- MAIN_MODULE=2 (Real ClickHouse)
|   (this module)  |
+------------------+
| - ClickHouse SQL |
| - Query executor |
| - malloc/free    |
| - VFS functions  |
| - Extension reg  |
| - Shared state   |
+--------+---------+
         |
    +----+----+
    |         |
    v         v
+-------+ +-------+
| ext1  | | ext2  |  <- SIDE_MODULE=2
+-------+ +-------+
```

## Files

- `core.cpp` - Main module implementation (to be created)
- `test_core.cpp` - C++ unit tests (TDD RED phase)
- `CMakeLists.txt` - Build configuration (to be created)

## Exported Functions

### Memory Management
- `malloc(size)` - Allocate memory
- `free(ptr)` - Free memory
- `core_alloc(size)` - Tracked allocation wrapper
- `core_free(ptr)` - Tracked free wrapper

### VFS (Virtual File System)
- `vfs_open(path, flags)` - Open a virtual file
- `vfs_read(fd, buffer, count)` - Read from file
- `vfs_write(fd, buffer, count)` - Write to file
- `vfs_close(fd)` - Close file
- `vfs_seek(fd, offset, whence)` - Seek in file
- `vfs_size(fd)` - Get file size

### Extension Registry
- `extension_register(name, init_fn)` - Register extension with init callback
- `extension_call(name, func, args)` - Call extension function
- `core_register_extension(name)` - Simple extension registration
- `core_get_extension_count()` - Get number of loaded extensions

### Initialization and Status
- `core_init()` - Initialize the core module
- `core_get_version()` - Get core version number
- `core_increment_query_count()` - Track query execution
- `core_get_query_count()` - Get query count

### Error Handling
- `core_log(message)` - Log a message
- `core_set_error(error)` - Set error message
- `core_get_error()` - Get last error message

### Utilities
- `core_add(a, b)` - Add two integers (for testing)
- `core_multiply(a, b)` - Multiply two integers
- `core_process_buffer(buffer, length)` - Sum buffer bytes

## Build Options

The module is built with these Emscripten settings:

```
-sMAIN_MODULE=2              # Dynamic linking support with DCE
-sALLOW_TABLE_GROWTH=1       # Allow function table to grow
-sALLOW_MEMORY_GROWTH=1      # Allow memory to grow
-sEXPORTED_FUNCTIONS=[...]   # Export required symbols
-sEXPORTED_RUNTIME_METHODS=[...] # Export JS runtime methods
-sMODULARIZE=1               # Create factory function
-sENVIRONMENT='web,node'     # Target both environments
```

## Testing

### TypeScript Tests (Workers Runtime)

```bash
pnpm test:workers
```

Tests in `tests/workers/core-module.test.ts` verify the module works correctly in Cloudflare Workers.

### C++ Unit Tests

```bash
# Build tests (native)
g++ -o test_core test_core.cpp core.cpp -DTEST_BUILD

# Run tests
./test_core

# Or build for WASM and run with Node
emcc test_core.cpp core.cpp -o test_core.js
node test_core.js
```

## TDD Workflow

1. **RED**: Tests in this directory are written first and fail because `core.cpp` doesn't exist
2. **GREEN**: Implement `core.cpp` to make tests pass
3. **REFACTOR**: Optimize the implementation while keeping tests green

## References

- [Emscripten Dynamic Linking](https://emscripten.org/docs/compiling/Dynamic-Linking.html)
- [WebAssembly Dynamic Linking](https://github.com/WebAssembly/tool-conventions/blob/main/DynamicLinking.md)
- [Spike Implementation](../dynamic/README.md)
