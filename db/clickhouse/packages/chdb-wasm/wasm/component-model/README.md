# WASM Component Model Spike for Real ClickHouse

**Date**: January 2026
**Status**: Research Complete - NOT READY FOR PRODUCTION USE

## Context

This project compiles **actual ClickHouse C++ code** (from `vendor/chdb`) to WebAssembly via Emscripten. This spike investigates whether the WASM Component Model could provide a better architecture for the compiled ClickHouse binary.

## Executive Summary

The WASM Component Model is a promising standard for modular WebAssembly composition, but it is **not yet viable** for our Cloudflare Workers use case. Native browser and V8 support does not exist, and Cloudflare Workers has only experimental, pre-alpha support for WIT interfaces with primitive types only.

**Recommendation**: Proceed with current Emscripten dynamic linking approach for real ClickHouse WASM. Revisit Component Model after WASI 0.3 release (expected mid-2026) and when Cloudflare announces production support.

## Current State of WASM Component Model

### Standardization Status

| Milestone | Status | Timeline |
|-----------|--------|----------|
| WASI Preview 2 (0.2) | Released | Early 2024 |
| Component Model Spec | Phase 1-2 at W3C | Ongoing |
| WASI 0.3 (async support) | In Development | Expected mid-2026 |
| WASI 1.0 | Planned | Late 2026+ |

The Component Model proposal is still in Phase 1-2 at the W3C. Movement to Phase 2+ is expected after WASI 0.3 release.

### Runtime Support

| Runtime | Support Level | Notes |
|---------|--------------|-------|
| **Wasmtime** | Full | First runtime with complete WASI 0.2 support (late 2024) |
| **Wasmer** | Full | Good component support |
| **V8/Chrome** | None | No native Component Model support |
| **Firefox** | None | No native Component Model support |
| **Safari** | None | No native Component Model support |
| **Cloudflare Workers** | Pre-alpha | WIT support in workers-rs for primitive types only |

### Browser Workaround: jco Transpilation

Browsers can run components via the `jco` transpiler:

```bash
# Transpile component to ES modules + core wasm
jco transpile component.wasm -o dist/
```

This generates JavaScript glue code that bridges the Component Model ABI to core WebAssembly calls. However:

- Adds build complexity
- Increases bundle size (JS glue + wasm)
- No direct performance benefit vs current approach

## Comparison: Component Model vs Emscripten Dynamic Linking

| Feature | Emscripten Dynamic Linking | WASM Component Model |
|---------|---------------------------|---------------------|
| **Purpose** | Runtime module linking | Language-agnostic composition |
| **Type System** | Basic wasm types (i32, f32, etc.) | Rich interface types via WIT |
| **Memory Model** | Shared memory | Shared-nothing OR shared-everything |
| **ABI Stability** | Unstable, Emscripten-specific | Standardized Canonical ABI |
| **Browser Support** | Yes (with JS runtime) | No native support (requires jco) |
| **Production Ready** | Yes | No |
| **Cross-Language** | No (C/C++ focused) | Yes (any language with wit-bindgen) |

### Key Architectural Difference

**Emscripten**: All modules share a single linear memory. Good for monolithic C/C++ codebases like ClickHouse.

**Component Model**: Supports "shared-nothing" linking where components have isolated memories. Data is copied/adapted between components using the Canonical ABI. Better for security isolation and language interop.

## Cloudflare Workers Support

### Current State

Cloudflare Workers supports:
- Basic WASM via `WebAssembly.instantiate()`
- Experimental WASI with limited syscalls
- Pre-alpha WIT support in workers-rs (primitive types only)

From Cloudflare docs:
> "The workers-rs library includes an experimental code generator which allows you to describe your RPC interface using WIT... However, this code generator is pre-alpha, with no support guarantee, and implemented only for primitive types at this time."

### What's Missing

- No native component instantiation
- No rich type support (strings, records, variants)
- No component composition (linking components together)
- No async component support

### Roadmap Uncertainty

Cloudflare has not announced a public roadmap for full Component Model support. Based on industry trends, production support is unlikely before late 2026.

## Tooling Assessment

### Available Tools

| Tool | Purpose | Status |
|------|---------|--------|
| **wasm-tools** | Low-level wasm manipulation | Stable |
| **wit-bindgen** | Generate language bindings from WIT | Stable |
| **jco** | JS Component toolchain | Active (v0.17.6) |
| **ComponentizeJS** | Build components from JS | Active |

### jco Capabilities

jco provides:
- `componentize`: Create component from JS/TS
- `transpile`: Convert component to ES modules
- `types`: Generate TS types from WIT
- `run/serve`: Execute WASI Command/HTTP components

### Size Overhead

Components built from JS/TS embed the SpiderMonkey runtime:
- **Rust component**: ~100KB
- **JS/TS component**: ~12MB (includes JS runtime)

For our use case (real ClickHouse WASM), we would build from C++ using wit-bindgen-c, avoiding the JS runtime overhead.

## Prototype Assessment

### WIT Interface Design

See `interfaces/sql-parser.wit` for a proposed interface design. The WIT format cleanly expresses our SQL parsing interface:

```wit
interface sql-parser {
  record parse-error {
    message: string,
    line: u32,
    column: u32,
  }

  parse: func(sql: string) -> result<ast, parse-error>
}
```

### Why We Cannot Prototype Today

1. **No Cloudflare Workers support** for full components
2. **No browser native support** - would need jco transpilation
3. **Limited benefit** over current Emscripten approach
4. **Tooling friction** - additional build steps with unclear benefit

## Recommendations

### Short Term (2026 H1)

**Continue with Emscripten dynamic linking for real ClickHouse**:
- Proven, working approach
- Direct browser/Workers support
- No additional build complexity

### Medium Term (2026 H2)

**Monitor Component Model progress**:
- Track WASI 0.3 release
- Watch Cloudflare announcements
- Evaluate jco transpilation overhead if needed

### Long Term (2027+)

**Adopt Component Model when viable**:
- Native browser support expected
- Cloudflare Workers production support
- Benefits: language interop, better isolation, standard ABI

## Key Questions Answered

### Is Component Model ready for production?

**No.** While the spec is maturing and tools like Wasmtime fully support it, browser and edge runtime support is lacking. The ecosystem is not production-ready for web deployment.

### Can we use it in Cloudflare Workers today?

**Not meaningfully.** Only pre-alpha WIT support for primitive types exists. Cannot load or compose actual components.

### What's the size overhead?

- For C/C++ components via wit-bindgen-c: minimal overhead
- For JS/TS components via ComponentizeJS: ~12MB (SpiderMonkey runtime)
- jco transpilation adds JS glue code proportional to interface complexity

### How does it compare to our other approaches?

| Approach | Browser Support | Workers Support | Maturity |
|----------|----------------|-----------------|----------|
| Static linking (current) | Yes | Yes | Production |
| Emscripten dynamic | Yes | Yes | Production |
| Component Model | Via jco only | Pre-alpha | Experimental |

## References

- [WebAssembly Component Model Spec](https://github.com/WebAssembly/component-model)
- [Component Model Book](https://component-model.bytecodealliance.org/)
- [wit-bindgen](https://github.com/bytecodealliance/wit-bindgen)
- [jco](https://github.com/bytecodealliance/jco)
- [Cloudflare Workers WASM Docs](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)
- [WASI 0.3 Roadmap](https://thenewstack.io/wasi-1-0-you-wont-know-when-webassembly-is-everywhere-in-2026/)
- [State of WebAssembly 2025-2026](https://platform.uno/blog/the-state-of-webassembly-2025-2026/)

## Conclusion

The WASM Component Model represents the future of modular WebAssembly, offering language interoperability, security isolation, and a standardized ABI. However, the lack of browser and Cloudflare Workers support makes it impractical for our immediate needs with real ClickHouse WASM.

**Decision**: Wait for the ecosystem to mature. Continue with Emscripten-based approaches for compiling real ClickHouse. Re-evaluate after WASI 0.3 release and Cloudflare production support announcement.
