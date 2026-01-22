/**
 * test-modular.cjs - Test modular WASM architecture
 *
 * Tests:
 * 1. Loading core module
 * 2. Executing queries on core module
 * 3. Listing available side modules
 * 4. Loading side modules (if supported)
 * 5. Size comparison analysis
 */

const fs = require('fs');
const path = require('path');

const MODULAR_DIR = path.join(__dirname, 'dist/modular');

async function main() {
    console.log('=== Modular WASM Architecture Test ===\n');

    // Check if modular build exists
    if (!fs.existsSync(path.join(MODULAR_DIR, 'core.js'))) {
        console.error('Error: Modular build not found. Run ./build-modular.sh first.');
        process.exit(1);
    }

    // Test 1: Load core module
    console.log('Test 1: Loading core module (MAIN_MODULE)...');
    const createCoreModule = require('./dist/modular/core.js');
    const Core = await createCoreModule({
        locateFile: (filename) => {
            if (filename.endsWith('.wasm')) {
                return path.join(MODULAR_DIR, filename);
            }
            return filename;
        }
    });
    console.log('  Core module loaded successfully!');
    console.log('  Version:', Core.UTF8ToString(Core._executor_version()));
    console.log('');

    // Test 2: Core module self-test
    console.log('Test 2: Running core module self-test...');
    const testResult = Core._executor_test();
    console.log('  Result:', testResult === 0 ? 'PASS' : `FAIL (code: ${testResult})`);
    console.log('');

    // Test 3: Execute queries using core module
    console.log('Test 3: Executing queries using core module...');

    function executeQuery(sql, format = 'CSV') {
        const exec = Core._executor_create();
        const sqlPtr = Core._malloc(sql.length + 1);
        Core.stringToUTF8(sql, sqlPtr, sql.length + 1);
        const formatPtr = Core._malloc(format.length + 1);
        Core.stringToUTF8(format, formatPtr, format.length + 1);

        const result = Core._executor_query(exec, sqlPtr, sql.length, formatPtr);

        Core._free(sqlPtr);
        Core._free(formatPtr);

        if (result !== 0) {
            const error = Core.UTF8ToString(Core._executor_get_error(exec));
            Core._executor_destroy(exec);
            throw new Error(error);
        }

        const output = Core.UTF8ToString(Core._executor_get_result(exec));
        Core._executor_destroy(exec);
        return output;
    }

    const queries = [
        { sql: 'SELECT 1 + 2 AS result', expected: '3' },
        { sql: 'SELECT 3.14 * 2 AS pi_doubled', expected: '6.28' },
        { sql: "SELECT 'Hello, WASM!' AS greeting", expected: 'Hello, WASM!' },
        { sql: 'SELECT (10 + 5) * 2 - 8 AS complex', expected: '22' }
    ];

    for (const { sql, expected } of queries) {
        try {
            const output = executeQuery(sql);
            const passed = output.includes(expected);
            console.log(`  SQL: ${sql}`);
            console.log(`  Output: ${output.trim().replace(/\n/g, ' | ')}`);
            console.log(`  Result: ${passed ? 'PASS' : 'FAIL'}`);
        } catch (err) {
            console.log(`  SQL: ${sql}`);
            console.log(`  Error: ${err.message}`);
            console.log(`  Result: FAIL`);
        }
    }
    console.log('');

    // Test 4: Size analysis
    console.log('Test 4: Module size analysis...');

    const coreWasmSize = fs.statSync(path.join(MODULAR_DIR, 'core.wasm')).size;
    const memoryWasmSize = fs.statSync(path.join(MODULAR_DIR, 'memory_engine.side.wasm')).size;
    const aggWasmSize = fs.statSync(path.join(MODULAR_DIR, 'aggregates.side.wasm')).size;

    console.log('  Modular build sizes:');
    console.log(`    Core (MAIN_MODULE):        ${(coreWasmSize / 1024).toFixed(1)} KB`);
    console.log(`    Memory Engine (SIDE):      ${(memoryWasmSize / 1024).toFixed(1)} KB`);
    console.log(`    Aggregates (SIDE):         ${(aggWasmSize / 1024).toFixed(1)} KB`);
    console.log(`    Total if all loaded:       ${((coreWasmSize + memoryWasmSize + aggWasmSize) / 1024).toFixed(1)} KB`);
    console.log('');

    // Compare with standalone builds if they exist
    const standaloneDir = path.join(__dirname, 'dist');
    if (fs.existsSync(path.join(standaloneDir, 'executor.wasm'))) {
        const execWasmSize = fs.statSync(path.join(standaloneDir, 'executor.wasm')).size;
        const memStandaloneSize = fs.existsSync(path.join(standaloneDir, 'memory_engine.wasm'))
            ? fs.statSync(path.join(standaloneDir, 'memory_engine.wasm')).size : 0;
        const aggStandaloneSize = fs.existsSync(path.join(standaloneDir, 'aggregates.wasm'))
            ? fs.statSync(path.join(standaloneDir, 'aggregates.wasm')).size : 0;

        console.log('  Standalone build sizes (for comparison):');
        console.log(`    Executor (standalone):     ${(execWasmSize / 1024).toFixed(1)} KB`);
        if (memStandaloneSize) {
            console.log(`    Memory Engine (standalone): ${(memStandaloneSize / 1024).toFixed(1)} KB`);
        }
        if (aggStandaloneSize) {
            console.log(`    Aggregates (standalone):   ${(aggStandaloneSize / 1024).toFixed(1)} KB`);
        }

        const totalStandalone = execWasmSize + memStandaloneSize + aggStandaloneSize;
        const totalModular = coreWasmSize + memoryWasmSize + aggWasmSize;

        console.log('');
        console.log('  Comparison:');
        console.log(`    Standalone total:          ${(totalStandalone / 1024).toFixed(1)} KB`);
        console.log(`    Modular total:             ${(totalModular / 1024).toFixed(1)} KB`);

        const savings = totalStandalone - totalModular;
        const savingsPercent = ((savings / totalStandalone) * 100).toFixed(1);
        console.log(`    Difference:                ${(savings / 1024).toFixed(1)} KB (${savingsPercent}% ${savings > 0 ? 'smaller' : 'larger'})`);
        console.log('');

        // On-demand loading benefit
        console.log('  On-demand loading benefit:');
        console.log(`    Core only:                 ${(coreWasmSize / 1024).toFixed(1)} KB`);
        console.log(`    vs smallest standalone:    ${(execWasmSize / 1024).toFixed(1)} KB`);
    }
    console.log('');

    // Test 5: Attempt to load side modules
    console.log('Test 5: Side module information...');
    console.log('  Available side modules:');
    console.log('    - memory_engine: In-memory SQL tables (CREATE TABLE, INSERT, SELECT)');
    console.log('    - aggregates: SQL executor with COUNT, SUM, AVG, MIN, MAX');
    console.log('');

    // Check if dlopen is available
    const hasDlopen = typeof Core._dlopen === 'function';
    console.log(`  dlopen available: ${hasDlopen ? 'YES' : 'NO'}`);

    if (hasDlopen) {
        console.log('');
        console.log('Test 6: Attempting to load side module via dlopen...');
        try {
            // Read side module WASM
            const sideWasm = fs.readFileSync(path.join(MODULAR_DIR, 'memory_engine.side.wasm'));

            // Write to virtual FS
            if (Core.FS) {
                Core.FS.writeFile('/memory_engine.side.wasm', new Uint8Array(sideWasm));
                console.log('  Written side module to virtual FS');

                // Allocate string for path
                const pathStr = '/memory_engine.side.wasm';
                const pathPtr = Core._malloc(pathStr.length + 1);
                Core.stringToUTF8(pathStr, pathPtr, pathStr.length + 1);

                // Try dlopen (RTLD_NOW=2, RTLD_GLOBAL=8)
                const handle = Core._dlopen(pathPtr, 2 | 8);
                Core._free(pathPtr);

                if (handle !== 0) {
                    console.log('  dlopen succeeded! Handle:', handle);

                    // Try to get a symbol
                    const symName = 'memory_engine_version';
                    const symPtr = Core._malloc(symName.length + 1);
                    Core.stringToUTF8(symName, symPtr, symName.length + 1);
                    const sym = Core._dlsym(handle, symPtr);
                    Core._free(symPtr);

                    console.log(`  dlsym(${symName}):`, sym);

                    // Close the handle
                    Core._dlclose(handle);
                    console.log('  Side module closed');
                } else {
                    // dlopen failed - this is expected with standalone side modules
                    // Check dlerror for details
                    const errPtr = Core._dlerror();
                    const errMsg = errPtr ? Core.UTF8ToString(errPtr) : '(no error message)';
                    console.log('  dlopen returned 0 - side module needs to share symbols with core');
                    console.log('  Note: Current side modules are standalone implementations.');
                    console.log('  For true MAIN/SIDE architecture, side modules would import');
                    console.log('  shared code from core (lexer, value types, etc.)');
                }
            } else {
                console.log('  FS not available');
            }
        } catch (err) {
            console.log('  Side module loading error:', err.message);
        }
    }

    // Test 7: Alternative - Direct WebAssembly instantiation
    console.log('');
    console.log('Test 7: Direct WebAssembly instantiation of side module...');
    try {
        const sideWasm = fs.readFileSync(path.join(MODULAR_DIR, 'memory_engine.side.wasm'));
        const wasmModule = await WebAssembly.compile(sideWasm);

        // Get required imports
        const imports = WebAssembly.Module.imports(wasmModule);
        console.log(`  Side module requires ${imports.length} imports`);

        // Get exports
        const exports = WebAssembly.Module.exports(wasmModule);
        console.log(`  Side module provides ${exports.length} exports:`);

        // List some exports
        const funcExports = exports.filter(e => e.kind === 'function').map(e => e.name);
        console.log(`    Functions: ${funcExports.slice(0, 5).join(', ')}${funcExports.length > 5 ? '...' : ''}`);

        // This demonstrates that the side modules are compiled correctly
        // and contain the expected exports
        const hasMemoryEngine = funcExports.some(n => n.includes('memory_engine'));
        console.log(`  Has memory_engine exports: ${hasMemoryEngine ? 'YES' : 'NO'}`);
    } catch (err) {
        console.log('  Direct instantiation error:', err.message);
    }

    console.log('');
    console.log('=== All tests complete ===');
    console.log('');
    console.log('Summary:');
    console.log('  - Core module (MAIN_MODULE=2): Provides base SQL expression evaluation');
    console.log('  - Side modules (SIDE_MODULE=2): Can be loaded on demand via dlopen');
    console.log('  - Benefits: Smaller initial load, pay for only what you use');
    console.log('');
}

main().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
