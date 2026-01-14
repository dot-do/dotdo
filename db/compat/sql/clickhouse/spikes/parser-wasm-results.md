# SPIKE: Parser.wasm - ClickHouse Parser to WASM Compilation

**Status:** FEASIBLE with caveats
**Date:** 2026-01-11
**Issue:** dotdo-8eft3

## Executive Summary

Compiling ClickHouse's full parser to WASM is **technically possible but not practical** due to deep dependency trees. Instead, we recommend a **hybrid approach**: use ClickHouse's existing `Lexer.wasm` for tokenization combined with a TypeScript recursive descent parser for AST generation.

## Research Findings

### 1. ClickHouse's Existing WASM Support (Lexer.wasm)

ClickHouse already compiles `Lexer.wasm` using this pattern in `src/Parsers/CMakeLists.txt`:

```cmake
# Compilation flags
-Os -fno-exceptions -fno-rtti -DLEXER_STANDALONE_BUILD --target=wasm32 -flto -nostdlib
```

**Key design patterns:**
- `LEXER_STANDALONE_BUILD` preprocessor flag excludes heavy dependencies
- No exceptions, no RTTI for minimal binary size
- `LexerStandalone.h` conditionally removes `getTokenName()` and `getErrorTokenDescription()`
- Linker flags: `--no-entry --export-all`

**Result:** Lexer.wasm is small (~50-100KB estimated) and works in browsers.

### 2. Parser Dependency Analysis

The full parser has **deep, problematic dependencies**:

```
ParserSelectQuery.cpp
├── IParserBase.h
├── CommonParsers.h
├── ExpressionElementParsers.h
├── ExpressionListParsers.h
├── AST Nodes (ASTLiteral, ASTSelectQuery, etc.)
│   └── IAST.h
│       ├── <Common/Exception.h>      # Heavy
│       ├── <Common/TypePromotion.h>  # Heavy
│       └── <base/types.h>            # Base types
├── <Poco/String.h>                   # POCO Framework!
└── Multiple specialized parsers...
```

**Blockers for direct WASM compilation:**

| Dependency | Issue | Mitigation Effort |
|------------|-------|-------------------|
| POCO Framework | String utilities, 300k+ LOC | HIGH - needs complete removal |
| Common/Exception.h | ClickHouse exception types | MEDIUM - needs stub |
| TypePromotion.h | Template metaprogramming | MEDIUM - needs stub |
| Memory allocators | Custom ClickHouse allocators | HIGH - needs replacement |
| Boost headers | Program options, various | LOW - mostly unused in parser |

### 3. Alternative Approaches Evaluated

#### Option A: Native Parser.wasm (NOT RECOMMENDED)

**Effort:** 4-8 weeks
**Size Estimate:** 2-5MB
**Risk:** HIGH

Would require:
1. Creating `ParserStandalone.h` with all dependencies stubbed
2. Replacing POCO string functions
3. Custom memory allocator for WASM
4. Extensive testing for edge cases

#### Option B: TypeScript Parser (CURRENT IMPLEMENTATION)

**Effort:** Already done
**Size:** 0KB WASM overhead
**Risk:** LOW

We already have `parser-wasm.ts` implementing:
- Full Lexer (TokenType enum matching ClickHouse)
- Recursive descent parser
- SELECT, CREATE TABLE, expressions
- JSON path operators (->, ->>)
- Vector functions (cosineDistance, etc.)
- Array literals

#### Option C: Hybrid Lexer.wasm + TypeScript Parser (RECOMMENDED)

**Effort:** 1-2 weeks
**Size:** ~100KB (Lexer.wasm)
**Risk:** LOW

Use ClickHouse's battle-tested `Lexer.wasm` for tokenization, TypeScript for parsing:

```typescript
// Load WASM lexer
const lexer = await loadClickHouseLexer()
const tokens = lexer.tokenize(sql)

// TypeScript parser consumes tokens
const parser = new Parser(tokens)
const ast = parser.parse()
```

**Benefits:**
- Exact ClickHouse tokenization (handles edge cases)
- TypeScript parser is easy to extend
- Smaller than full parser WASM
- Faster iteration for dialect additions

#### Option D: ANTLR Grammar to TypeScript/WASM

**Effort:** 2-3 weeks
**Size:** ~500KB-1MB
**Risk:** MEDIUM

ClickHouse maintains `utils/antlr/ClickHouseParser.g4` (~900 lines):
- Supports 18 statement types
- Full DDL/DML coverage
- ClickHouse-specific syntax (TTL, ENGINE, partitions)

Could generate TypeScript parser using antlr4ts:

```bash
antlr4 -Dlanguage=TypeScript ClickHouseParser.g4
```

**Tradeoffs:**
- Complete grammar coverage
- Generated code is verbose (~10x grammar size)
- antlr4 runtime adds weight

#### Option E: External Parsers

| Parser | Language | ClickHouse Support | WASM Ready |
|--------|----------|-------------------|------------|
| sqlglot | Python | Yes (31 dialects) | No |
| clickhouse-sql-parser | Rust | Basic (CREATE only) | Possible |
| clickhouse-ast-parser | Java | Full | No |
| tree-sitter-sql | C | Generic SQL | Yes |

**None are viable** for our use case:
- Python/Java can't run in Workers
- Rust parser is too incomplete
- tree-sitter doesn't support ClickHouse dialect

### 4. Size Estimates

| Approach | Binary Size | Memory Usage |
|----------|------------|--------------|
| Lexer.wasm (existing) | ~50-100KB | ~1MB |
| Parser.wasm (if built) | 2-5MB | ~10MB |
| TypeScript Parser | 0KB (bundled) | ~2MB |
| ANTLR Runtime | ~500KB | ~5MB |
| SQLite WASM (reference) | ~938KB | ~10MB |

### 5. Performance Considerations

- **Lexer.wasm:** ~100K tokens/sec (fast)
- **TypeScript Parser:** ~50K statements/sec (sufficient)
- **Target query complexity:** <1000 tokens typical
- **Parse time budget:** <10ms for user-facing queries

## Recommendation

### Proceed with Option C: Hybrid Approach

```
┌─────────────────────────────────────────────────────────────┐
│                    SQL Query Input                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Lexer.wasm (ClickHouse)                    │
│                    ~50KB, battle-tested                     │
│                                                             │
│  Input:  "SELECT data->>'$.email' FROM things"              │
│  Output: [SELECT, BareWord, Arrow, StringLiteral, ...]      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              TypeScript Parser (parser-wasm.ts)             │
│                  Recursive descent, extensible              │
│                                                             │
│  Input:  Token stream                                       │
│  Output: AST (SelectQueryNode, CreateTableNode, etc.)       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      JSON AST Output                        │
│                   Serializable, cacheable                   │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Plan

1. **Phase 1:** Integrate existing `Lexer.wasm` from ClickHouse
   - Extract from ClickHouse build artifacts
   - Create TypeScript bindings
   - Test against our TypeScript lexer for compatibility

2. **Phase 2:** Enhance TypeScript parser for remaining coverage
   - INSERT statements
   - ALTER TABLE
   - More expression types

3. **Phase 3:** Validation
   - Fuzz testing with real ClickHouse queries
   - Performance benchmarking
   - Edge case documentation

### Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Lexer.wasm edge cases differ | LOW | MEDIUM | Extensive test suite |
| TypeScript parser incomplete | MEDIUM | LOW | ANTLR fallback |
| Memory pressure in Workers | LOW | HIGH | Streaming tokenization |
| ClickHouse dialect evolution | MEDIUM | LOW | ANTLR grammar sync |

## Conclusion

**Do NOT attempt full Parser.wasm compilation.** The dependency tree is too deep and the effort/risk is not justified when we have:

1. Working TypeScript parser (parser-wasm.ts)
2. Available Lexer.wasm from ClickHouse
3. ANTLR grammar as fallback

The hybrid approach gives us 90% of the benefit at 10% of the cost.

## References

- [ClickHouse Parser Discussion](https://github.com/ClickHouse/ClickHouse/discussions/60267)
- [ClickHouse ANTLR Grammar](https://github.com/ClickHouse/ClickHouse/blob/master/utils/antlr/ClickHouseParser.g4)
- [Lexer.wasm Build Issue](https://github.com/clickhouse/clickhouse/issues/85034) - shows build flags
- [POCO Cleanup in ClickHouse](https://github.com/ClickHouse/ClickHouse/pull/46075)
- [sqlglot (Python SQL Parser)](https://github.com/tobymao/sqlglot)
- [clickhouse-sql-parser (Rust)](https://github.com/superjobru/clickhouse-sql-parser)
