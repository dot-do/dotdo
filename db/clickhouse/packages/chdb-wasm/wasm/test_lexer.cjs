/**
 * test_lexer.cjs - Test the ClickHouse SQL Lexer WASM module
 */

const path = require('path');

async function main() {
    console.log('=== ClickHouse SQL Lexer WASM Test ===\n');

    // Load the module
    const createLexerModule = require('./dist/lexer.js');
    const Module = await createLexerModule();

    console.log('Module loaded successfully!\n');

    // Test 1: Basic lexer test function
    console.log('Test 1: Running built-in self-test...');
    const testResult = Module._lexer_test();
    console.log(`  Result: ${testResult === 0 ? 'PASS' : 'FAIL (code: ' + testResult + ')'}\n`);

    // Test 2: Tokenize a SQL query
    console.log('Test 2: Tokenizing SQL query...');
    const sql = 'SELECT id, name FROM users WHERE age > 21';
    console.log(`  SQL: "${sql}"\n`);

    // Allocate memory for the SQL string
    const sqlLen = sql.length;
    const sqlPtr = Module._malloc(sqlLen + 1);
    Module.stringToUTF8(sql, sqlPtr, sqlLen + 1);

    // Create lexer
    const lexer = Module._lexer_create(sqlPtr, sqlLen);
    if (!lexer) {
        console.log('  ERROR: Failed to create lexer');
        return 1;
    }

    // Tokenize
    console.log('  Tokens:');
    let tokenCount = 0;
    let significantTokens = [];

    while (true) {
        const tokenType = Module._lexer_next_token(lexer);
        const begin = Module._lexer_get_token_begin(lexer);
        const end = Module._lexer_get_token_end(lexer);
        const typeName = Module.UTF8ToString(Module._token_type_name(tokenType));
        const tokenText = sql.substring(begin, end);

        tokenCount++;

        if (Module._lexer_token_is_end(tokenType)) {
            break;
        }

        if (Module._lexer_token_is_significant(tokenType)) {
            significantTokens.push({ type: typeName, text: tokenText });
            console.log(`    ${typeName.padEnd(20)} "${tokenText}"`);
        }

        if (Module._lexer_token_is_error(tokenType)) {
            console.log(`  ERROR: Token error at position ${begin}`);
            break;
        }
    }

    // Cleanup
    Module._lexer_destroy(lexer);
    Module._free(sqlPtr);

    console.log(`\n  Total tokens: ${tokenCount}`);
    console.log(`  Significant tokens: ${significantTokens.length}`);

    // Verify expected tokens
    const expectedTokens = ['SELECT', 'id', ',', 'name', 'FROM', 'users', 'WHERE', 'age', '>', '21'];
    const actualTexts = significantTokens.map(t => t.text);
    const allMatch = expectedTokens.every((t, i) => actualTexts[i] === t);

    console.log(`\n  Verification: ${allMatch ? 'PASS' : 'FAIL'}`);

    console.log('\n=== All tests complete ===');
    return allMatch ? 0 : 1;
}

main().then(code => process.exit(code)).catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
