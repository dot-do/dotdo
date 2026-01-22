# Component Model Assessment: Wait or Proceed?

**TL;DR**: Proceed with alternatives. Component Model is not ready for Cloudflare Workers.

## Decision Matrix

| Criteria | Component Model | Emscripten Dynamic | Verdict |
|----------|----------------|-------------------|---------|
| Works in CF Workers today | No | Yes | Emscripten |
| Works in browsers today | Via jco only | Yes | Emscripten |
| Build complexity | High | Medium | Emscripten |
| Future-proof | Yes | Maybe | Component Model |
| Language interop | Excellent | C/C++ only | Component Model |
| Maturity | Experimental | Production | Emscripten |

**Winner for 2026**: Emscripten Dynamic Linking

## Timeline Assessment

```
Jan 2026 (Now)
    |
    v
    [WASI 0.2 - Released, Component Model in runtimes like Wasmtime]
    |
    |  Expected mid-2026
    v
    [WASI 0.3 - Async support, Component Model spec to Phase 2+]
    |
    |  Expected late 2026 / 2027
    v
    [Browser native support begins?]
    [Cloudflare production support?]
    |
    |  2027+
    v
    [Component Model potentially viable for our use case]
```

## What We'd Gain from Component Model (Eventually)

1. **Language Interoperability**
   - Could write chdb components in Rust, C++, or even Go
   - Mix and match languages per component

2. **Security Isolation**
   - Shared-nothing linking isolates component memory
   - Bugs in one component can't corrupt another

3. **Standardized ABI**
   - No more Emscripten-specific hacks
   - Components work across any compliant runtime

4. **Dynamic Composition**
   - Link components at deploy time, not build time
   - Potentially smaller initial downloads (load components on demand)

## What We'd Lose (For Now)

1. **Production Deployment**
   - Can't deploy to Cloudflare Workers
   - Can't run natively in browsers

2. **Build Simplicity**
   - Additional tools: wasm-tools, wit-bindgen, jco
   - Multiple build stages

3. **Ecosystem Maturity**
   - Fewer examples and documentation
   - More likely to hit edge cases

## Recommended Path Forward

### Phase 1: Now (Q1 2026)

Continue with Emscripten-based builds:
- Static linking for monolithic deployments
- Dynamic linking experiments for modular loading
- Focus on size optimization

### Phase 2: Monitor (Q2-Q3 2026)

Watch for:
- WASI 0.3 release announcement
- Cloudflare Workers Component Model announcements
- Browser engine implementation signals

### Phase 3: Prototype (Q4 2026)

When WASI 0.3 ships:
- Validate WIT interfaces work with our types
- Test jco transpilation overhead
- Benchmark vs Emscripten approach

### Phase 4: Migrate (2027)

When native support arrives:
- Gradual migration starting with parser component
- Keep Emscripten fallback for compatibility
- Full migration once support is widespread

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Component Model delayed | Medium | Low | We're not depending on it |
| Emscripten becomes obsolete | Low | Medium | Our code is portable C++ |
| CF Workers never supports components | Low | Low | jco provides fallback |
| Component Model gains rapid adoption | Low | Low | We can migrate later |

## Files Created in This Spike

```
wasm/component-model/
  README.md           # Full research findings
  ASSESSMENT.md       # This decision document
  interfaces/
    sql-parser.wit    # WIT interface definitions (design prototype)
```

## Conclusion

The Component Model is the right direction for the industry, but the timing is wrong for us. We should:

1. **Proceed with Emscripten** for production deployments
2. **Keep WIT definitions** as design documentation
3. **Re-evaluate in late 2026** after WASI 0.3 and ecosystem maturation

The WIT interfaces we've defined (`interfaces/sql-parser.wit`) serve as forward-looking design documents that will help when migration becomes viable.
