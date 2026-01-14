# EdgeQL Parser Approach Evaluation - Spike Findings

**Issue:** dotdo-56wx9
**Date:** 2026-01-10
**Author:** Claude (AI-assisted analysis)

## Executive Summary

**Recommendation: Hand-Rolled Recursive Descent Parser**

For the dotdo Gel compatibility layer, a hand-rolled recursive descent parser is the optimal choice. It provides the best balance of:
- Zero runtime dependencies (critical for Workers bundle size)
- Full control over error messages
- Simplest maintenance path
- Proven pattern in this codebase (see: CouchDB compat layer)

---

## Research Findings

### EdgeQL Grammar Complexity

Based on research of the official EdgeDB/Gel documentation and parser implementation:

| Metric | Value | Source |
|--------|-------|--------|
| Total productions (full EdgeQL) | 1,912 | [EdgeDB Blog](https://www.geldata.com/blog/python-rust-chumsky-tree-sitter-and-edgedb-walk-into-a-bar) |
| Grammar class | LR(1) | EdgeDB implementation |
| Our target subset | ~50-100 productions | Estimated |

The full EdgeQL grammar is substantial (1,912 productions), but our compatibility layer only needs a subset:
- SELECT with shapes and filters
- INSERT with assignments
- UPDATE with shape modifications
- DELETE with filters
- Basic expressions (paths, literals, operators)

This subset is well within hand-rolled parser territory.

### Parser Generator Options Evaluated

#### 1. Chevrotain

| Aspect | Assessment |
|--------|------------|
| Bundle size | ~42.5 kB minified+gzip |
| Worker compatibility | Yes (ES2015+) |
| Performance | Excellent (fastest JS parser toolkit) |
| Error messages | Good (built-in recovery) |
| Learning curve | Medium |

**Pros:**
- Best-in-class performance for JavaScript parsers
- Excellent error recovery out of the box
- Active maintenance (6M+ monthly downloads)

**Cons:**
- 42.5 kB adds to bundle size
- Grammar defined in JavaScript (harder to read than BNF)
- Runtime dependency

#### 2. Peggy (PEG.js successor)

| Aspect | Assessment |
|--------|------------|
| Bundle size | ~0 kB (pre-generated) |
| Worker compatibility | Yes |
| Performance | Good |
| Error messages | Good |
| Learning curve | Low |

**Pros:**
- Pre-generation eliminates runtime dependency
- Clean grammar syntax (PEG notation)
- Modern and maintained

**Cons:**
- PEG grammars can be tricky for left-recursion
- Generated code can be large for complex grammars
- Build step required

#### 3. Nearley

| Aspect | Assessment |
|--------|------------|
| Bundle size | ~15 kB runtime |
| Worker compatibility | Yes |
| Performance | Slower (Earley algorithm) |
| Error messages | Excellent |
| Learning curve | Low |

**Pros:**
- Handles ambiguous grammars
- Best error recovery
- Simple BNF-like syntax

**Cons:**
- Slower than alternatives
- Earley algorithm overhead for simple grammars
- Overkill for our deterministic subset

#### 4. Tree-sitter

| Aspect | Assessment |
|--------|------------|
| Bundle size | ~150+ kB (WASM) |
| Worker compatibility | Requires WASM |
| Performance | Excellent |
| Error messages | Excellent |
| Learning curve | High |

**Pros:**
- Battle-tested by major editors (VS Code, etc.)
- Incremental parsing
- Error recovery

**Cons:**
- WASM dependency (150+ kB)
- Overkill for runtime parsing
- Primarily designed for editor use

#### 5. Hand-Rolled Recursive Descent (Recommended)

| Aspect | Assessment |
|--------|------------|
| Bundle size | ~0 kB (included in compat layer) |
| Worker compatibility | Native |
| Performance | Excellent |
| Error messages | Full control |
| Learning curve | Low (familiar pattern) |

**Pros:**
- Zero dependencies
- Smallest possible bundle impact
- Full control over error messages
- Matches existing codebase patterns (CouchDB compat)
- Easy to debug and maintain
- No build step

**Cons:**
- More initial code to write
- Error recovery must be implemented manually
- Grammar changes require code changes

---

## Codebase Pattern Analysis

Examined existing compat layers in the dotdo codebase:

### CouchDB Compat Layer (`/compat/couchdb/couchdb.ts`)

Uses **runtime JavaScript parsing** via sandboxed `new Function()`:
- Parses CouchDB map functions (JavaScript strings)
- Compiles to executable functions
- ~400 LOC including sandbox security

This demonstrates the pattern of parsing DSL strings at runtime without external parser dependencies.

### DuckDB Compat Layer (`/compat/duckdb/`)

Uses **no parsing** - passes SQL strings directly to DuckDB WASM. Not applicable to EdgeQL case.

### Supabase Compat Layer (`/compat/supabase/`)

Uses **no parsing** - implements API-level compatibility. Not applicable to EdgeQL case.

---

## Prototype Implementation

A working prototype parser was created: `/db/compat/gel/edgeql-parser.ts`

### Statistics

| Metric | Value |
|--------|-------|
| Total LOC | ~580 |
| Tokenizer LOC | ~170 |
| Parser LOC | ~280 |
| SQL Compiler LOC | ~80 |
| Test LOC | ~250 |
| Tests passing | 25/25 |

### Supported Syntax

```edgeql
# Simple select with shape
select User { name }

# Nested shapes
select User { name, posts: { title } }

# Filter expressions
select User { name } filter .active = true

# Insert with assignments
insert User { name := 'Alice', age := 30 }
```

### Example Output

```typescript
// Input
parse('select User { name, posts: { title } } filter .active = true')

// Output AST
{
  type: 'SelectStatement',
  target: 'User',
  shape: {
    type: 'Shape',
    fields: [
      { type: 'ShapeField', name: 'name' },
      { type: 'ShapeField', name: 'posts', shape: { fields: [{ name: 'title' }] } }
    ]
  },
  filter: {
    type: 'FilterExpression',
    condition: {
      type: 'BinaryExpression',
      operator: '=',
      left: { type: 'PathExpression', path: ['active'] },
      right: { type: 'BooleanLiteral', value: true }
    }
  }
}

// Compiled SQL
'SELECT name, posts_id FROM user WHERE active = 1'
```

---

## LOC Estimate for Full Parser

Based on the prototype and the EdgeQL subset we need:

| Component | Prototype LOC | Full Parser Estimate |
|-----------|---------------|---------------------|
| Tokenizer | 170 | 300-400 |
| Parser (AST) | 280 | 800-1200 |
| SQL Compiler | 80 | 400-600 |
| Type inference | 0 | 200-300 |
| Error recovery | 30 | 150-200 |
| **Total** | **560** | **1,850-2,700** |

Additional features requiring more code:
- UPDATE and DELETE statements (+200 LOC)
- Complex expressions (LIKE, IN, arithmetic) (+300 LOC)
- Subqueries (+200 LOC)
- Type casting (+100 LOC)
- Optional and required links (+150 LOC)

**Estimated total for production parser: ~2,500 LOC**

---

## Bundle Size Analysis

| Approach | Base Size | Parser Addition | Total Impact |
|----------|-----------|-----------------|--------------|
| Hand-rolled | 0 | ~8-12 kB | 8-12 kB |
| Chevrotain | 42.5 kB | ~5-8 kB grammar | 47-50 kB |
| Peggy | 0 | ~15-25 kB generated | 15-25 kB |
| Nearley | 15 kB | ~10-15 kB grammar | 25-30 kB |
| Tree-sitter | 150 kB | +30 kB grammar | 180+ kB |

**Hand-rolled provides the smallest bundle footprint** - critical for Workers edge deployment.

---

## Risk Assessment

### Hand-Rolled Approach Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Grammar edge cases | Medium | Medium | Comprehensive test suite, fuzzing |
| Poor error messages | Low | Low | Invest in error formatting upfront |
| Maintenance burden | Low | Low | Simple recursive descent is well-understood |
| Feature creep | Medium | Medium | Strict subset definition, schema-first approach |

### Key Mitigations

1. **Test-driven development**: Write tests for each grammar production
2. **Error message templates**: Design error message format upfront
3. **Grammar specification**: Document supported subset explicitly
4. **Incremental implementation**: Start with SELECT, add statements iteratively

---

## Recommendation Details

### Why Hand-Rolled Over Chevrotain?

Chevrotain is the strongest alternative, but:
1. **42.5 kB matters** in Workers environment (150ms cold start budget)
2. **We need ~50-100 productions**, not thousands
3. **CouchDB precedent** shows this pattern works in the codebase
4. **Error messages** are critical for developer experience - full control is valuable

### Implementation Roadmap

1. **Phase 1 (Week 1)**: Tokenizer + SELECT with shapes
2. **Phase 2 (Week 2)**: INSERT, UPDATE, DELETE
3. **Phase 3 (Week 3)**: Expressions, operators, path navigation
4. **Phase 4 (Week 4)**: Error recovery, edge cases, polish

### Decision Criteria Met

| Criterion | Hand-Rolled | Meets? |
|-----------|-------------|--------|
| Zero dependencies | Yes | Yes |
| Bundle < 15 kB | ~10 kB | Yes |
| Workers compatible | Yes | Yes |
| Good error messages | Full control | Yes |
| Maintainable | ~2,500 LOC | Yes |
| Matches codebase patterns | CouchDB precedent | Yes |

---

## Prototype Code Location

- Parser: `/db/compat/gel/edgeql-parser.ts`
- Tests: `/db/compat/gel/edgeql-parser.test.ts`

Run tests:
```bash
npx vitest run db/compat/gel/edgeql-parser.test.ts
```

---

## References

- [EdgeDB Blog: Parser Implementation](https://www.geldata.com/blog/python-rust-chumsky-tree-sitter-and-edgedb-walk-into-a-bar)
- [EdgeQL Lexical Structure](https://docs.geldata.com/database/reference/edgeql/lexical)
- [Chevrotain npm](https://www.npmjs.com/package/chevrotain)
- [Peggy Documentation](https://peggyjs.org/documentation.html)
- [Nearley GitHub](https://github.com/kach/nearley)

---

## Conclusion

The hand-rolled recursive descent parser approach is recommended for the dotdo Gel compatibility layer. The prototype demonstrates feasibility with 25 passing tests, and the estimated ~2,500 LOC for a production parser is manageable. The zero-dependency nature and bundle size advantages align with Workers deployment constraints.

**Next step:** Expand prototype to cover UPDATE/DELETE and move to production implementation.
