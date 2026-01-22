/**
 * test_real_parser.cjs - Comprehensive tests for REAL ClickHouse Parser WASM
 *
 * Tests the real_parser.wasm module that is compiled from the actual
 * ClickHouse parser code using PARSER_STANDALONE_BUILD mode.
 *
 * Run: node test_real_parser.cjs
 */

const createRealParserModule = require('./dist/real_parser.js');

(async () => {
    console.log('=== REAL ClickHouse SQL Parser WASM Tests ===\n');

    const Module = await createRealParserModule();
    console.log('Module loaded successfully!\n');

    let passed = 0;
    let failed = 0;

    function test(name, condition) {
        if (condition) {
            console.log(`  PASS: ${name}`);
            passed++;
        } else {
            console.log(`  FAIL: ${name}`);
            failed++;
        }
    }

    function createParser(sql) {
        const sqlLen = sql.length;
        const sqlPtr = Module._malloc(sqlLen + 1);
        Module.stringToUTF8(sql, sqlPtr, sqlLen + 1);
        const parser = Module._real_parser_create(sqlPtr, sqlLen);
        return { parser, sqlPtr };
    }

    function destroyParser({ parser, sqlPtr }) {
        Module._real_parser_destroy(parser);
        Module._free(sqlPtr);
    }

    function parseKeyword(parser, keyword, startToken = 0) {
        const endTokenPtr = Module._malloc(8);
        const keywordPtr = Module._malloc(keyword.length + 1);
        Module.stringToUTF8(keyword, keywordPtr, keyword.length + 1);

        const result = Module._real_parser_parse_keyword(parser, keywordPtr, startToken, endTokenPtr);
        const endToken = Module.getValue(endTokenPtr, 'i32');

        Module._free(endTokenPtr);
        Module._free(keywordPtr);

        return { success: result === 1, endToken };
    }

    // Test 1: Built-in self-test
    console.log('Test 1: Built-in self-test');
    test('real_parser_test returns 0', Module._real_parser_test() === 0);
    console.log('');

    // Test 2: Basic tokenization
    console.log('Test 2: Basic tokenization');
    {
        const ctx = createParser('SELECT 1');
        const count = Module._real_parser_get_token_count(ctx.parser);
        test('SELECT 1 has 2 tokens', count === 2);
        destroyParser(ctx);
    }
    {
        const ctx = createParser('SELECT id, name FROM users');
        const count = Module._real_parser_get_token_count(ctx.parser);
        test('SELECT id, name FROM users has 6 tokens', count === 6);
        destroyParser(ctx);
    }
    console.log('');

    // Test 3: Balanced parentheses
    console.log('Test 3: Balanced parentheses');
    {
        const ctx = createParser('SELECT (1 + 2) * 3');
        test('SELECT (1 + 2) * 3 is balanced', Module._real_parser_check_balanced(ctx.parser) === 1);
        destroyParser(ctx);
    }
    {
        const ctx = createParser('SELECT ((a + b) * c) FROM t');
        test('SELECT ((a + b) * c) FROM t is balanced', Module._real_parser_check_balanced(ctx.parser) === 1);
        destroyParser(ctx);
    }
    {
        const ctx = createParser('SELECT (a');
        test('SELECT (a is NOT balanced', Module._real_parser_check_balanced(ctx.parser) === 0);
        destroyParser(ctx);
    }
    {
        const ctx = createParser('SELECT a)');
        test('SELECT a) is NOT balanced', Module._real_parser_check_balanced(ctx.parser) === 0);
        destroyParser(ctx);
    }
    console.log('');

    // Test 4: Single keywords
    console.log('Test 4: Single keyword parsing');
    {
        const ctx = createParser('SELECT id FROM users');
        const result = parseKeyword(ctx.parser, 'SELECT', 0);
        test('SELECT keyword parsed', result.success);
        test('SELECT advances to token 1', result.endToken === 1);
        destroyParser(ctx);
    }
    {
        const ctx = createParser('FROM users');
        const result = parseKeyword(ctx.parser, 'FROM', 0);
        test('FROM keyword parsed', result.success);
        destroyParser(ctx);
    }
    {
        const ctx = createParser('WHERE id = 1');
        const result = parseKeyword(ctx.parser, 'WHERE', 0);
        test('WHERE keyword parsed', result.success);
        destroyParser(ctx);
    }
    console.log('');

    // Test 5: Compound keywords
    console.log('Test 5: Compound keyword parsing');
    {
        const ctx = createParser('ORDER BY name');
        const result = parseKeyword(ctx.parser, 'ORDER BY', 0);
        test('ORDER BY keyword parsed', result.success);
        test('ORDER BY advances to token 2', result.endToken === 2);
        destroyParser(ctx);
    }
    {
        const ctx = createParser('GROUP BY category');
        const result = parseKeyword(ctx.parser, 'GROUP BY', 0);
        test('GROUP BY keyword parsed', result.success);
        destroyParser(ctx);
    }
    {
        const ctx = createParser('LEFT OUTER JOIN t');
        const result = parseKeyword(ctx.parser, 'LEFT OUTER JOIN', 0);
        test('LEFT OUTER JOIN keyword parsed', result.success);
        destroyParser(ctx);
    }
    console.log('');

    // Test 6: Keyword NOT matching
    console.log('Test 6: Keyword NOT matching');
    {
        const ctx = createParser('INSERT INTO t');
        const result = parseKeyword(ctx.parser, 'SELECT', 0);
        test('SELECT does not match INSERT', !result.success);
        destroyParser(ctx);
    }
    {
        const ctx = createParser('ORDER name');
        const result = parseKeyword(ctx.parser, 'ORDER BY', 0);
        test('ORDER BY does not match ORDER (no BY)', !result.success);
        destroyParser(ctx);
    }
    console.log('');

    // Test 7: Token validation
    console.log('Test 7: Token validation');
    {
        const ctx = createParser('SELECT 1 + 2');
        test('Valid SQL has valid tokens', Module._real_parser_validate_tokens(ctx.parser) === 1);
        destroyParser(ctx);
    }
    console.log('');

    // Test 8: Multi-line query
    console.log('Test 8: Multi-line query');
    {
        // ClickHouse handles multi-line queries correctly
        const ctx = createParser("SELECT\n  id,\n  name\nFROM\n  users");
        const count = Module._real_parser_get_token_count(ctx.parser);
        test('Multi-line query tokenizes correctly', count === 6);
        test('Multi-line query has valid tokens', Module._real_parser_validate_tokens(ctx.parser) === 1);
        destroyParser(ctx);
    }
    console.log('');

    // Test 9: Complex queries
    console.log('Test 9: Complex query tokenization');
    {
        const sql = 'SELECT user_id, COUNT(*) as cnt FROM events WHERE date >= today() - 7 GROUP BY user_id ORDER BY cnt DESC LIMIT 10';
        const ctx = createParser(sql);
        const count = Module._real_parser_get_token_count(ctx.parser);
        test('Complex query tokenizes (> 20 tokens)', count > 20);
        test('Complex query is balanced', Module._real_parser_check_balanced(ctx.parser) === 1);
        destroyParser(ctx);
    }
    console.log('');

    // Summary
    console.log('=== Test Summary ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total:  ${passed + failed}`);

    process.exit(failed > 0 ? 1 : 0);
})();
