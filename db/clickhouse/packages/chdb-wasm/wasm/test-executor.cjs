/**
 * test-executor.cjs - Test the minimal SQL Executor WASM module
 *
 * This tests the executor module which provides basic SQL expression evaluation
 * without requiring the full ClickHouse infrastructure.
 *
 * Supported:
 *   - SELECT <literal> [AS <alias>]
 *   - SELECT <expr> [AS <alias>]
 *   - Multiple columns: SELECT 1, 2, 3
 *   - Arithmetic: +, -, *, /, %
 *   - Parentheses
 *   - Integers, floats, strings
 *   - Output formats: CSV, TSV, JSON
 *
 * Usage:
 *   node test-executor.cjs
 */

const path = require('path');

async function main() {
    console.log('=== Minimal SQL Executor WASM Test ===\n');

    // Load the module
    const createExecutorModule = require('./dist/executor.js');
    const Module = await createExecutorModule();

    console.log('Executor module loaded successfully!');
    console.log('Version:', Module.UTF8ToString(Module._executor_version()));
    console.log('');

    // Track test results
    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            const result = fn();
            if (result) {
                console.log(`  [PASS] ${name}`);
                passed++;
            } else {
                console.log(`  [FAIL] ${name}`);
                failed++;
            }
        } catch (e) {
            console.log(`  [ERROR] ${name}: ${e.message}`);
            failed++;
        }
    }

    // Test 1: Built-in self-test
    console.log('Test 1: Built-in self-test');
    test('executor_test()', () => Module._executor_test() === 0);
    console.log('');

    // Create executor context
    const exec = Module._executor_create();

    // Helper function to run a query
    function runQuery(sql, format = 'CSV') {
        const sqlPtr = Module._malloc(sql.length + 1);
        Module.stringToUTF8(sql, sqlPtr, sql.length + 1);

        // Allocate format string in WASM memory
        const formatPtr = Module._malloc(format.length + 1);
        Module.stringToUTF8(format, formatPtr, format.length + 1);

        const result = Module._executor_query(exec, sqlPtr, sql.length, formatPtr);
        Module._free(sqlPtr);
        Module._free(formatPtr);

        if (result === 0) {
            const output = Module.UTF8ToString(Module._executor_get_result(exec));
            return { success: true, output };
        } else {
            const error = Module.UTF8ToString(Module._executor_get_error(exec));
            return { success: false, error };
        }
    }

    // Test 2: Simple integer
    console.log('Test 2: SELECT 1 + 2 AS result');
    {
        const r = runQuery('SELECT 1 + 2 AS result');
        console.log('  Output:', r.success ? r.output.trim() : `Error: ${r.error}`);
        test('Returns success', () => r.success);
        test('Contains header "result"', () => r.output.includes('result'));
        test('Contains value 3', () => r.output.includes('3'));
    }
    console.log('');

    // Test 3: String literal
    console.log("Test 3: SELECT 'hello' AS greeting");
    {
        const r = runQuery("SELECT 'hello' AS greeting");
        console.log('  Output:', r.success ? r.output.trim() : `Error: ${r.error}`);
        test('Returns success', () => r.success);
        test('Contains "hello"', () => r.output.includes('hello'));
        test('Contains "greeting"', () => r.output.includes('greeting'));
    }
    console.log('');

    // Test 4: Complex expression with parentheses
    console.log('Test 4: SELECT (1 + 2) * 3 - 4 AS calc');
    {
        const r = runQuery('SELECT (1 + 2) * 3 - 4 AS calc');
        console.log('  Output:', r.success ? r.output.trim() : `Error: ${r.error}`);
        // (1+2)*3-4 = 3*3-4 = 9-4 = 5
        test('Returns success', () => r.success);
        test('Contains value 5', () => r.output.includes('5'));
    }
    console.log('');

    // Test 5: Multiple columns
    console.log('Test 5: SELECT 10, 20, 30');
    {
        const r = runQuery('SELECT 10, 20, 30');
        console.log('  Output:', r.success ? r.output.trim() : `Error: ${r.error}`);
        test('Returns success', () => r.success);
        test('Contains 10', () => r.output.includes('10'));
        test('Contains 20', () => r.output.includes('20'));
        test('Contains 30', () => r.output.includes('30'));
    }
    console.log('');

    // Test 6: Float arithmetic
    console.log('Test 6: SELECT 3.14 * 2 AS pi_doubled');
    {
        const r = runQuery('SELECT 3.14 * 2 AS pi_doubled');
        console.log('  Output:', r.success ? r.output.trim() : `Error: ${r.error}`);
        test('Returns success', () => r.success);
        test('Contains 6.28', () => r.output.includes('6.28'));
    }
    console.log('');

    // Test 7: Division
    console.log('Test 7: SELECT 10 / 3 AS div_result');
    {
        const r = runQuery('SELECT 10 / 3 AS div_result');
        console.log('  Output:', r.success ? r.output.trim() : `Error: ${r.error}`);
        test('Returns success', () => r.success);
        // Integer division: 10 / 3 = 3
        test('Contains 3', () => r.output.includes('3'));
    }
    console.log('');

    // Test 8: Modulo
    console.log('Test 8: SELECT 17 % 5 AS mod_result');
    {
        const r = runQuery('SELECT 17 % 5 AS mod_result');
        console.log('  Output:', r.success ? r.output.trim() : `Error: ${r.error}`);
        test('Returns success', () => r.success);
        // 17 % 5 = 2
        test('Contains 2', () => r.output.includes('2'));
    }
    console.log('');

    // Test 9: Negative numbers
    console.log('Test 9: SELECT -5 + 10 AS negative_test');
    {
        const r = runQuery('SELECT -5 + 10 AS negative_test');
        console.log('  Output:', r.success ? r.output.trim() : `Error: ${r.error}`);
        test('Returns success', () => r.success);
        test('Contains 5', () => r.output.includes('5'));
    }
    console.log('');

    // Test 10: JSON output format
    console.log('Test 10: SELECT 42 AS answer (JSON format)');
    {
        const r = runQuery('SELECT 42 AS answer', 'JSON');
        console.log('  Output:', r.success ? r.output : `Error: ${r.error}`);
        test('Returns success', () => r.success);
        test('Contains "answer"', () => r.output.includes('"answer"'));
        test('Contains 42', () => r.output.includes('42'));
        test('Contains "meta"', () => r.output.includes('"meta"'));
        test('Contains "data"', () => r.output.includes('"data"'));
    }
    console.log('');

    // Test 11: TSV output format
    console.log('Test 11: SELECT 1, 2, 3 (TSV format)');
    {
        const r = runQuery('SELECT 1, 2, 3', 'TSV');
        console.log('  Output:', r.success ? r.output.trim() : `Error: ${r.error}`);
        test('Returns success', () => r.success);
        test('Contains tab characters', () => r.output.includes('\t'));
    }
    console.log('');

    // Test 12: NULL handling
    console.log('Test 12: SELECT NULL AS null_value');
    {
        const r = runQuery('SELECT NULL AS null_value');
        console.log('  Output:', r.success ? r.output.trim() : `Error: ${r.error}`);
        test('Returns success', () => r.success);
        test('Contains NULL', () => r.output.includes('NULL'));
    }
    console.log('');

    // Test 13: Mixed types
    console.log("Test 13: SELECT 1 AS num, 'text' AS str, 3.14 AS flt");
    {
        const r = runQuery("SELECT 1 AS num, 'text' AS str, 3.14 AS flt");
        console.log('  Output:', r.success ? r.output.trim() : `Error: ${r.error}`);
        test('Returns success', () => r.success);
        test('Contains num', () => r.output.includes('num'));
        test('Contains str', () => r.output.includes('str'));
        test('Contains flt', () => r.output.includes('flt'));
    }
    console.log('');

    // Test 14: Escaped strings
    console.log("Test 14: SELECT 'hello\\nworld' AS escaped");
    {
        const r = runQuery("SELECT 'hello\\nworld' AS escaped");
        console.log('  Output:', r.success ? JSON.stringify(r.output.trim()) : `Error: ${r.error}`);
        test('Returns success', () => r.success);
    }
    console.log('');

    // Test 15: Error handling - unsupported query
    console.log('Test 15: Error handling (INSERT query)');
    {
        const r = runQuery('INSERT INTO table VALUES (1)');
        console.log('  Result:', r.success ? 'Unexpectedly succeeded' : `Expected error: ${r.error}`);
        test('Returns error for INSERT', () => !r.success);
    }
    console.log('');

    // Clean up
    Module._executor_destroy(exec);

    // Summary
    console.log('='.repeat(50));
    console.log(`Test Summary: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(50));

    return failed === 0 ? 0 : 1;
}

main().then(code => process.exit(code)).catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
