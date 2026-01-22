# chdb-wasm WASM Compilation Report

## Overview

This document describes the WASM compilation strategy for chdb components and tracks what has been successfully compiled.

## Strategy

The approach follows ClickHouse's existing pattern for `Lexer.wasm`:

1. **Standalone headers without dependencies** - Using `LEXER_STANDALONE_BUILD` flag
2. **No exceptions, no RTTI** - Compile with `-fno-exceptions -fno-rtti`
3. **No standard library** - Using `-nostdlib` for raw WASM
4. **Custom minimal implementations** - `LexerStandalone.h` provides minimal helpers

## Build Outputs

### Successfully Compiled

| Component | Output Files | Size | Status |
|-----------|-------------|------|--------|
| SQL Lexer (standalone) | `Lexer.wasm` | ~7KB | Working |
| SQL Lexer (with JS bindings) | `lexer.js`, `lexer.wasm` | ~15KB + ~15KB | Working |

### Build Artifacts

```
wasm/dist/
  Lexer.wasm      # Raw WASM, no JS glue (ClickHouse-style)
  lexer.js        # JavaScript module loader
  lexer.wasm      # WASM with Emscripten runtime
  package.json    # CommonJS compatibility
```

## Compilation Flags

### Standalone Lexer.wasm (ClickHouse-style)
```bash
emcc \
  -Os \
  -fno-exceptions \
  -fno-rtti \
  -DLEXER_STANDALONE_BUILD \
  -s STANDALONE_WASM=1 \
  --no-entry \
  Lexer.cpp \
  -o Lexer.wasm
```

### Lexer with JavaScript Bindings
```bash
emcc \
  -Os \
  -fno-exceptions \
  -fno-rtti \
  -DLEXER_STANDALONE_BUILD \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='createLexerModule' \
  -s ALLOW_MEMORY_GROWTH=1 \
  lexer_bindings.cpp \
  Lexer.cpp \
  -o lexer.js
```

## JavaScript API

The compiled lexer module exposes:

```javascript
// Load module
const createLexerModule = require('./dist/lexer.js');
const Module = await createLexerModule();

// Create lexer for SQL string
const sqlPtr = Module._malloc(sql.length + 1);
Module.stringToUTF8(sql, sqlPtr, sql.length + 1);
const lexer = Module._lexer_create(sqlPtr, sql.length);

// Get tokens
while (true) {
  const tokenType = Module._lexer_next_token(lexer);
  if (Module._lexer_token_is_end(tokenType)) break;

  const begin = Module._lexer_get_token_begin(lexer);
  const end = Module._lexer_get_token_end(lexer);
  const typeName = Module.UTF8ToString(Module._token_type_name(tokenType));

  console.log(typeName, sql.substring(begin, end));
}

// Cleanup
Module._lexer_destroy(lexer);
Module._free(sqlPtr);
```

## Token Types

The lexer recognizes these token types:

- **Literals**: `Whitespace`, `Comment`, `BareWord`, `Number`, `StringLiteral`, `QuotedIdentifier`, `HereDoc`
- **Brackets**: `OpeningRoundBracket`, `ClosingRoundBracket`, `OpeningSquareBracket`, `ClosingSquareBracket`, `OpeningCurlyBrace`, `ClosingCurlyBrace`
- **Operators**: `Comma`, `Semicolon`, `Dot`, `Asterisk`, `Plus`, `Minus`, `Slash`, `Percent`, `Arrow`, `Colon`, `DoubleColon`, `Equals`, `NotEquals`, `Less`, `Greater`, `LessOrEquals`, `GreaterOrEquals`, `Spaceship`, `PipeMark`, `Concatenation`, `Caret`, `QuestionMark`, `At`, `DoubleAt`, `DollarSign`, `VerticalDelimiter`
- **Control**: `EndOfStream`
- **Errors**: `Error`, `ErrorMultilineCommentIsNotClosed`, `ErrorSingleQuoteIsNotClosed`, `ErrorDoubleQuoteIsNotClosed`, `ErrorBackQuoteIsNotClosed`, `ErrorSingleExclamationMark`, `ErrorSinglePipeMark`, `ErrorWrongNumber`, `ErrorMaxQuerySizeExceeded`

## Future Work

### Parser (TODO)
The SQL Parser depends on:
- Lexer (done)
- TokenIterator
- AST classes (IAST, ASTPtr)
- Exception handling (needs workaround)

Challenges:
- Heavy use of exceptions
- Dependency on AST allocation
- Templates and virtual functions

### Minimal Query Executor (TODO)
Would require:
- Parser (TODO)
- Memory storage engine only
- Stripped-down interpreter

## Key Insights

1. **LEXER_STANDALONE_BUILD** is the key - it activates `LexerStandalone.h` which provides:
   - Custom `size_t`, `uint8_t` typedefs
   - `find_first_symbols<>` template
   - Character classification functions (`isNumericASCII`, etc.)
   - Minimal `std::string_view` implementation
   - UTF-8 handling (`skipWhitespacesUTF8`, `isContinuationOctet`)
   - Placement new operator

2. **The lexer is completely self-contained** - no external dependencies at all

3. **Parser will be much harder** - it uses exceptions extensively and depends on the AST subsystem

## Testing

Run tests with:
```bash
./build.sh test
```

Expected output:
```
=== ClickHouse SQL Lexer WASM Test ===

Module loaded successfully!

Test 1: Running built-in self-test...
  Result: PASS

Test 2: Tokenizing SQL query...
  SQL: "SELECT id, name FROM users WHERE age > 21"

  Tokens:
    BareWord             "SELECT"
    BareWord             "id"
    Comma                ","
    BareWord             "name"
    BareWord             "FROM"
    BareWord             "users"
    BareWord             "WHERE"
    BareWord             "age"
    Greater              ">"
    Number               "21"

  Total tokens: 19
  Significant tokens: 10

  Verification: PASS
```
