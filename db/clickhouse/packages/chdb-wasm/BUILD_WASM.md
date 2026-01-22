# Building chdb-wasm from Source

This document describes how to set up the Emscripten SDK and build WASM modules for chdb-wasm.

## Prerequisites

- **Operating System**: macOS, Linux, or Windows (with WSL)
- **CMake**: Version 3.20 or higher
- **Node.js**: Version 18 or higher
- **Git**: For cloning the Emscripten SDK

## Emscripten SDK Installation

The Emscripten SDK (emsdk) is required to compile C++ code to WebAssembly.

### Quick Installation

```bash
# Clone the SDK
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk

# Navigate to the SDK directory
cd ~/emsdk

# Install and activate the latest version
./emsdk install latest
./emsdk activate latest

# Add to your shell profile (~/.bashrc, ~/.zshrc, etc.)
echo 'source ~/emsdk/emsdk_env.sh' >> ~/.zshrc
source ~/.zshrc
```

### Verify Installation

```bash
# Check emcc is available
emcc --version

# Or use our check script
pnpm build:wasm:check
```

Expected output:
```
emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 3.x.x
```

### Alternative Installation Locations

The build system searches for emsdk in these locations (in order):
1. `$EMSDK` environment variable
2. `/opt/emsdk`
3. `$HOME/emsdk`
4. `/usr/local/emsdk`

## Build Commands

### Using npm Scripts

```bash
# Build all WASM modules (default: standard profile)
pnpm build:wasm

# Build specific profiles
pnpm build:wasm:minimal    # ~3MB gzipped - Essential features only
pnpm build:wasm:standard   # ~10MB gzipped - Balanced size/features
pnpm build:wasm:full       # ~20MB gzipped - All features
pnpm build:wasm:all        # Build all profiles

# Build individual modules (legacy system)
pnpm build:wasm:executor       # Core SQL executor
pnpm build:wasm:aggregates     # Aggregate functions
pnpm build:wasm:memory-engine  # In-memory tables
pnpm build:wasm:json-format    # JSON parsing
pnpm build:wasm:csv-format     # CSV/TSV parsing

# Build modular architecture (MAIN_MODULE/SIDE_MODULE)
pnpm build:wasm:modular

# View module sizes
pnpm build:wasm:size-report

# Clean and rebuild
pnpm build:wasm:clean
```

### Using Build Scripts Directly

```bash
# CMake-based build (recommended for full chdb integration)
./build/build.sh --help
./build/build.sh standard
./build/build.sh --clean minimal

# Legacy shell script (for standalone modules)
./wasm/build.sh --help
./wasm/build.sh all
./wasm/build.sh executor

# Modular build (MAIN_MODULE + SIDE_MODULE)
./wasm/build-modular.sh
./wasm/build-modular.sh core
./wasm/build-modular.sh test
```

## Build Profiles

| Profile | Size (gzipped) | Features | Use Case |
|---------|---------------|----------|----------|
| `minimal` | ~3MB | Memory engine, JSON, Parquet, Core functions | Edge functions, minimal footprint |
| `standard` | ~10MB | + MergeTree, S3, URL, CSV, Arrow, Aggregates | Most production use cases |
| `full` | ~20MB | All engines, formats, and functions | Full ClickHouse compatibility |

### Feature Matrix

#### Table Engines

| Engine | minimal | standard | full |
|--------|---------|----------|------|
| Memory | Yes | Yes | Yes |
| MergeTree | - | Yes | Yes |
| URL | Yes | Yes | Yes |
| S3 | - | Yes | Yes |
| File | - | Yes | Yes |
| Buffer | - | Yes | Yes |
| Join | - | Yes | Yes |
| Set | - | - | Yes |
| Dictionary | - | - | Yes |

#### Output Formats

| Format | minimal | standard | full |
|--------|---------|----------|------|
| JSON | Yes | Yes | Yes |
| Parquet | Yes | Yes | Yes |
| CSV | - | Yes | Yes |
| TSV | - | Yes | Yes |
| Arrow | - | Yes | Yes |
| Avro | - | - | Yes |
| ORC | - | - | Yes |
| Protobuf | - | - | Yes |

## Build Output Locations

### CMake Build System (`./build/build.sh`)

```
dist/
  minimal/
    chdb-minimal.js
    chdb-minimal.wasm
    package.json
  standard/
    chdb-standard.js
    chdb-standard.wasm
    package.json
  full/
    chdb-full.js
    chdb-full.wasm
    package.json
```

### Legacy Build System (`./wasm/build.sh`)

```
wasm/dist/
  executor.js
  executor.wasm
  aggregates.js
  aggregates.wasm
  memory_engine.js
  memory_engine.wasm
  json_format.js
  json_format.wasm
  csv_format.js
  csv_format.wasm
  lexer.js
  lexer.wasm
  parser.js
  parser.wasm
  modular/
    core.js
    core.wasm
    memory_engine.side.wasm
    aggregates.side.wasm
```

## Cloudflare Workers Compatibility

The WASM modules are optimized for Cloudflare Workers with these constraints:

- **Memory**: 128MB maximum (configurable via `MAXIMUM_MEMORY`)
- **CPU**: 50ms CPU time limit per request
- **Binary Size**: Larger modules may require lazy loading
- **SIMD**: Supported (enabled via `-msimd128`)

### Recommended Configuration

For Cloudflare Workers, we recommend:
- Use the `minimal` or `standard` profile
- Enable lazy WASM loading for faster cold starts
- Use R2 for storing larger WASM modules

## Troubleshooting

### "emcc not found"

```bash
# Ensure emsdk is sourced
source ~/emsdk/emsdk_env.sh

# Or reinstall
cd ~/emsdk
./emsdk install latest
./emsdk activate latest
```

### "CMake version too old"

```bash
# macOS
brew install cmake

# Linux
sudo apt-get install cmake
```

### Build fails with memory errors

```bash
# Increase Node.js heap size
export NODE_OPTIONS="--max-old-space-size=8192"

# Or reduce parallelism
JOBS=2 ./build/build.sh standard
```

### WASM module too large

- Try the `minimal` profile
- Use wasm-opt for additional optimization:
  ```bash
  wasm-opt -Oz --strip-debug chdb.wasm -o chdb.opt.wasm
  ```

## Development Workflow

### Testing WASM Modules

```bash
# Run all tests (in workerd environment)
pnpm test

# Run WASM-specific tests
pnpm test:wasm

# Run integration tests
pnpm test:integration

# Test module loading directly
node ./wasm/build.sh test-executor
```

### Updating WASM After Changes

```bash
# Rebuild changed module
pnpm build:wasm:executor

# Verify sizes haven't regressed
pnpm build:wasm:size-report

# Run tests
pnpm test
```

## CI/CD Integration

For CI environments, install Emscripten in your workflow:

```yaml
# GitHub Actions example
- name: Setup Emscripten
  uses: mymindstorm/setup-emsdk@v14
  with:
    version: 'latest'

- name: Build WASM
  run: pnpm build:wasm:standard
```

## Architecture Details

### Modular WASM Build

The modular build system uses Emscripten's dynamic linking:

- **MAIN_MODULE**: Core executor with base infrastructure
- **SIDE_MODULE**: Extensions loaded via `dlopen()`

This allows lazy loading of features:
```javascript
// Load core module
const core = await createCoreModule();

// Dynamically load extension
const result = core.dlopen('/extensions/aggregates.side.wasm');
```

### Compilation Flags

Key Emscripten flags used:

```
-Oz                          # Aggressive size optimization
-flto                        # Link-time optimization
-fno-exceptions              # Disable C++ exceptions
-fno-rtti                    # Disable runtime type information
-sALLOW_MEMORY_GROWTH=1      # Allow WASM memory to grow
-sMAXIMUM_MEMORY=134217728   # 128MB maximum
-sMODULARIZE=1               # Create ES module
-sEXPORT_ES6=1               # Export as ES6 module
-msimd128                    # Enable SIMD
```

## References

- [Emscripten Documentation](https://emscripten.org/docs/)
- [Cloudflare Workers WASM](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)
- [chdb GitHub Repository](https://github.com/chdb-io/chdb)
- [ClickHouse Source](https://github.com/ClickHouse/ClickHouse)
