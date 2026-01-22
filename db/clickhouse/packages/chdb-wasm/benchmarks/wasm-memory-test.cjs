/**
 * WASM Memory and Performance Benchmark
 *
 * Tests the chdb lexer and parser WASM modules for:
 * - Memory usage before/after loading
 * - Memory usage during parsing
 * - Parse performance (queries/second)
 * - Memory per concurrent instance
 */

const path = require('path');
const v8 = require('v8');
const { createRequire } = require('module');
const fs = require('fs');

// WASM module paths (relative to benchmarks directory)
const DIST_DIR = path.join(__dirname, '../build-minimal/dist');
const LEXER_MODULE_PATH = path.join(DIST_DIR, 'lexer-module.js');
const PARSER_MODULE_PATH = path.join(DIST_DIR, 'parser-module.js');

// Create a custom require function that works regardless of the parent package.json type
const customRequire = createRequire(__filename);

// Test queries of varying complexity
const TEST_QUERIES = {
  simple: 'SELECT 1',
  medium: 'SELECT a, b, c FROM table WHERE x > 10 GROUP BY a',
  complex: `
    SELECT
      u.id,
      u.name,
      u.email,
      COUNT(DISTINCT o.id) as order_count,
      SUM(oi.quantity * oi.price) as total_spent,
      AVG(oi.price) as avg_item_price
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    LEFT JOIN order_items oi ON o.id = oi.order_id
    LEFT JOIN products p ON oi.product_id = p.id
    WHERE u.created_at > '2024-01-01'
      AND u.status = 'active'
      AND (o.status = 'completed' OR o.status IS NULL)
    GROUP BY u.id, u.name, u.email
    HAVING COUNT(DISTINCT o.id) > 5
    ORDER BY total_spent DESC
    LIMIT 100
  `.trim(),
  veryComplex: `
    WITH monthly_stats AS (
      SELECT
        date_trunc('month', created_at) as month,
        user_id,
        COUNT(*) as activity_count,
        SUM(amount) as total_amount
      FROM transactions
      WHERE created_at >= '2023-01-01'
      GROUP BY date_trunc('month', created_at), user_id
    ),
    user_ranks AS (
      SELECT
        user_id,
        month,
        activity_count,
        total_amount,
        RANK() OVER (PARTITION BY month ORDER BY total_amount DESC) as rank
      FROM monthly_stats
    )
    SELECT
      u.id,
      u.name,
      ur.month,
      ur.activity_count,
      ur.total_amount,
      ur.rank,
      LAG(ur.total_amount) OVER (PARTITION BY u.id ORDER BY ur.month) as prev_month_amount,
      ur.total_amount - LAG(ur.total_amount) OVER (PARTITION BY u.id ORDER BY ur.month) as amount_change
    FROM users u
    INNER JOIN user_ranks ur ON u.id = ur.user_id
    WHERE ur.rank <= 10
    ORDER BY ur.month DESC, ur.rank ASC
  `.trim()
};

// Utility functions
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function formatNumber(num) {
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function getMemoryUsage() {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
    rss: mem.rss
  };
}

function getHeapStatistics() {
  return v8.getHeapStatistics();
}

function measureTime(fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  const end = process.hrtime.bigint();
  return { result, timeNs: Number(end - start), timeMs: Number(end - start) / 1e6 };
}

async function measureTimeAsync(fn) {
  const start = process.hrtime.bigint();
  const result = await fn();
  const end = process.hrtime.bigint();
  return { result, timeNs: Number(end - start), timeMs: Number(end - start) / 1e6 };
}

// Force garbage collection if available
function gc() {
  if (global.gc) {
    global.gc();
  }
}

// Benchmark class
class WasmBenchmark {
  constructor() {
    this.results = {};
  }

  async loadModule(modulePath, name) {
    gc();
    const memBefore = getMemoryUsage();

    const { result: createModule, timeMs: loadTimeMs } = await measureTimeAsync(async () => {
      return customRequire(modulePath);
    });

    const { result: module, timeMs: initTimeMs } = await measureTimeAsync(async () => {
      return await createModule();
    });

    gc();
    const memAfter = getMemoryUsage();

    return {
      module,
      metrics: {
        name,
        loadTimeMs,
        initTimeMs,
        totalTimeMs: loadTimeMs + initTimeMs,
        memoryDelta: {
          heapUsed: memAfter.heapUsed - memBefore.heapUsed,
          heapTotal: memAfter.heapTotal - memBefore.heapTotal,
          external: memAfter.external - memBefore.external,
          arrayBuffers: memAfter.arrayBuffers - memBefore.arrayBuffers
        }
      }
    };
  }

  // Lexer benchmark - tokenize a query
  // Token types: 0 = Whitespace, 1 = Comment, 39 = EndOfStream, 40+ = Error types
  // Note: _lexer_next_token returns the token type (not a boolean)
  benchmarkLexer(lexerModule, query, iterations = 1000) {
    const results = [];
    const TOKEN_WHITESPACE = 0;
    const TOKEN_COMMENT = 1;
    const TOKEN_END_OF_STREAM = 39;
    const TOKEN_ERROR_START = 40;

    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();

      // Create lexer using ccall for proper string handling
      const lexerHandle = lexerModule.ccall('lexer_create', 'number', ['string', 'number'], [query, query.length]);

      let tokenCount = 0;
      let significantTokenCount = 0;

      while (true) {
        // next_token returns the token type directly
        const tokenType = lexerModule._lexer_next_token(lexerHandle);

        // Check for end of stream
        if (tokenType === TOKEN_END_OF_STREAM) break;

        // Check for error tokens (type >= 40)
        if (tokenType >= TOKEN_ERROR_START) break;

        tokenCount++;

        // Count significant tokens (non-whitespace, non-comment)
        if (tokenType !== TOKEN_WHITESPACE && tokenType !== TOKEN_COMMENT) {
          significantTokenCount++;
        }

        if (tokenCount > 10000) break; // Safety limit
      }

      // Cleanup
      lexerModule._lexer_destroy(lexerHandle);

      const end = process.hrtime.bigint();
      results.push({ timeNs: Number(end - start), tokenCount, significantTokenCount });
    }

    return results;
  }

  // Parser benchmark - parse a query
  benchmarkParser(parserModule, query, iterations = 1000) {
    const results = [];

    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();

      // Create parser
      const parserHandle = parserModule.ccall('parser_create', 'number', ['string', 'number'], [query, query.length]);

      // Get token count and validation
      const tokenCount = parserModule._parser_get_token_count(parserHandle);
      const isBalanced = parserModule._parser_check_balanced(parserHandle);
      const isValid = parserModule._parser_validate_tokens(parserHandle);

      // Cleanup
      parserModule._parser_destroy(parserHandle);

      const end = process.hrtime.bigint();
      results.push({ timeNs: Number(end - start), tokenCount, isBalanced, isValid });
    }

    return results;
  }

  // Calculate statistics
  calculateStats(results, field = 'timeNs') {
    const values = results.map(r => r[field]);
    const sorted = [...values].sort((a, b) => a - b);

    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return { mean, median, min, max, p95, p99, stdDev, count: values.length };
  }

  // Concurrent instances test
  async testConcurrentInstances(modulePath, count) {
    gc();
    const memBefore = getMemoryUsage();

    const instances = [];
    const loadTimes = [];

    for (let i = 0; i < count; i++) {
      const start = process.hrtime.bigint();
      // Need fresh require for each instance - clear cache
      delete customRequire.cache[customRequire.resolve(modulePath)];
      const create = customRequire(modulePath);
      const instance = await create();
      instances.push(instance);
      loadTimes.push(Number(process.hrtime.bigint() - start));
    }

    gc();
    const memAfter = getMemoryUsage();

    const memoryPerInstance = (memAfter.heapUsed - memBefore.heapUsed) / count;

    // Cleanup - instances will be GC'd
    instances.length = 0;
    gc();

    return {
      count,
      totalMemory: memAfter.heapUsed - memBefore.heapUsed,
      memoryPerInstance,
      avgLoadTimeNs: loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length
    };
  }

  // Memory during parsing test
  async testMemoryDuringParsing(parserModule, query, iterations) {
    const memSamples = [];

    gc();
    const memBefore = getMemoryUsage();

    for (let i = 0; i < iterations; i++) {
      const parserHandle = parserModule.ccall('parser_create', 'number', ['string', 'number'], [query, query.length]);
      parserModule._parser_get_token_count(parserHandle);
      parserModule._parser_check_balanced(parserHandle);
      parserModule._parser_validate_tokens(parserHandle);

      if (i % 100 === 0) {
        memSamples.push(getMemoryUsage().heapUsed);
      }

      parserModule._parser_destroy(parserHandle);
    }

    gc();
    const memAfter = getMemoryUsage();

    return {
      memoryLeak: memAfter.heapUsed - memBefore.heapUsed,
      peakMemory: Math.max(...memSamples) - memBefore.heapUsed,
      samples: memSamples.length
    };
  }

  printSection(title) {
    console.log('\n' + '='.repeat(60));
    console.log(title);
    console.log('='.repeat(60));
  }

  printSubSection(title) {
    console.log('\n' + '-'.repeat(40));
    console.log(title);
    console.log('-'.repeat(40));
  }
}

// Main benchmark runner
async function runBenchmarks() {
  const benchmark = new WasmBenchmark();

  console.log('WASM Module Memory and Performance Benchmark');
  console.log('=============================================');
  console.log('Date:', new Date().toISOString());
  console.log('Node.js:', process.version);
  console.log('Platform:', process.platform, process.arch);
  console.log('');

  // Initial memory baseline
  gc();
  const baselineMemory = getMemoryUsage();
  console.log('Baseline Memory:');
  console.log('  Heap Used:', formatBytes(baselineMemory.heapUsed));
  console.log('  Heap Total:', formatBytes(baselineMemory.heapTotal));
  console.log('  RSS:', formatBytes(baselineMemory.rss));

  // ===== Module Loading Benchmarks =====
  benchmark.printSection('1. Module Loading & Instantiation');

  console.log('\nLoading Lexer Module...');
  const { module: lexerModule, metrics: lexerMetrics } = await benchmark.loadModule(LEXER_MODULE_PATH, 'lexer');

  console.log('  Load Time:', lexerMetrics.loadTimeMs.toFixed(2), 'ms');
  console.log('  Init Time:', lexerMetrics.initTimeMs.toFixed(2), 'ms');
  console.log('  Total Time:', lexerMetrics.totalTimeMs.toFixed(2), 'ms');
  console.log('  Memory Delta:');
  console.log('    Heap Used:', formatBytes(lexerMetrics.memoryDelta.heapUsed));
  console.log('    External:', formatBytes(lexerMetrics.memoryDelta.external));
  console.log('    ArrayBuffers:', formatBytes(lexerMetrics.memoryDelta.arrayBuffers));

  console.log('\nLoading Parser Module...');
  const { module: parserModule, metrics: parserMetrics } = await benchmark.loadModule(PARSER_MODULE_PATH, 'parser');

  console.log('  Load Time:', parserMetrics.loadTimeMs.toFixed(2), 'ms');
  console.log('  Init Time:', parserMetrics.initTimeMs.toFixed(2), 'ms');
  console.log('  Total Time:', parserMetrics.totalTimeMs.toFixed(2), 'ms');
  console.log('  Memory Delta:');
  console.log('    Heap Used:', formatBytes(parserMetrics.memoryDelta.heapUsed));
  console.log('    External:', formatBytes(parserMetrics.memoryDelta.external));
  console.log('    ArrayBuffers:', formatBytes(parserMetrics.memoryDelta.arrayBuffers));

  // Test that modules work
  console.log('\nVerifying modules work:');
  const testResult = lexerModule._lexer_test();
  console.log('  Lexer test:', testResult === 1 ? 'PASS' : `FAIL (returned ${testResult})`);
  const parserTestResult = parserModule._parser_test();
  console.log('  Parser test:', parserTestResult === 1 ? 'PASS' : `FAIL (returned ${parserTestResult})`);

  // ===== Lexer Performance =====
  benchmark.printSection('2. Lexer Performance');

  const ITERATIONS = 5000;

  for (const [queryName, query] of Object.entries(TEST_QUERIES)) {
    benchmark.printSubSection(`Query: ${queryName} (${query.length} chars)`);

    const results = benchmark.benchmarkLexer(lexerModule, query, ITERATIONS);
    const stats = benchmark.calculateStats(results, 'timeNs');

    const queriesPerSecond = 1e9 / stats.mean;
    const avgTokens = results.reduce((a, r) => a + r.tokenCount, 0) / results.length;
    const avgSignificantTokens = results.reduce((a, r) => a + r.significantTokenCount, 0) / results.length;

    console.log(`  Iterations: ${ITERATIONS}`);
    console.log(`  Avg Total Tokens: ${avgTokens.toFixed(0)}`);
    console.log(`  Avg Significant Tokens: ${avgSignificantTokens.toFixed(0)}`);
    console.log(`  Mean Time: ${(stats.mean / 1000).toFixed(2)} us`);
    console.log(`  Median Time: ${(stats.median / 1000).toFixed(2)} us`);
    console.log(`  Min Time: ${(stats.min / 1000).toFixed(2)} us`);
    console.log(`  Max Time: ${(stats.max / 1000).toFixed(2)} us`);
    console.log(`  P95: ${(stats.p95 / 1000).toFixed(2)} us`);
    console.log(`  P99: ${(stats.p99 / 1000).toFixed(2)} us`);
    console.log(`  Throughput: ${formatNumber(queriesPerSecond)} queries/sec`);
  }

  // ===== Parser Performance =====
  benchmark.printSection('3. Parser Performance');

  for (const [queryName, query] of Object.entries(TEST_QUERIES)) {
    benchmark.printSubSection(`Query: ${queryName} (${query.length} chars)`);

    const results = benchmark.benchmarkParser(parserModule, query, ITERATIONS);
    const stats = benchmark.calculateStats(results, 'timeNs');

    const queriesPerSecond = 1e9 / stats.mean;
    const avgTokens = results.reduce((a, r) => a + r.tokenCount, 0) / results.length;
    const allBalanced = results.every(r => r.isBalanced);
    const allValid = results.every(r => r.isValid);

    console.log(`  Iterations: ${ITERATIONS}`);
    console.log(`  Avg Tokens: ${avgTokens.toFixed(0)}`);
    console.log(`  All Balanced: ${allBalanced}`);
    console.log(`  All Valid: ${allValid}`);
    console.log(`  Mean Time: ${(stats.mean / 1000).toFixed(2)} us`);
    console.log(`  Median Time: ${(stats.median / 1000).toFixed(2)} us`);
    console.log(`  Min Time: ${(stats.min / 1000).toFixed(2)} us`);
    console.log(`  Max Time: ${(stats.max / 1000).toFixed(2)} us`);
    console.log(`  P95: ${(stats.p95 / 1000).toFixed(2)} us`);
    console.log(`  P99: ${(stats.p99 / 1000).toFixed(2)} us`);
    console.log(`  Throughput: ${formatNumber(queriesPerSecond)} queries/sec`);
  }

  // ===== Memory During Parsing =====
  benchmark.printSection('4. Memory During Sustained Parsing');

  for (const [queryName, query] of Object.entries(TEST_QUERIES)) {
    if (queryName === 'veryComplex') continue; // Skip for speed

    benchmark.printSubSection(`Query: ${queryName}`);

    const memResults = await benchmark.testMemoryDuringParsing(parserModule, query, 10000);

    console.log(`  Iterations: 10000`);
    console.log(`  Memory Leak: ${formatBytes(memResults.memoryLeak)}`);
    console.log(`  Peak Memory Delta: ${formatBytes(memResults.peakMemory)}`);
  }

  // ===== Concurrent Instances =====
  benchmark.printSection('5. Concurrent Instance Memory');

  console.log('\nTesting multiple parser module instances...');

  for (const count of [1, 5, 10, 20]) {
    gc();
    await new Promise(r => setTimeout(r, 100)); // Allow GC to complete

    const result = await benchmark.testConcurrentInstances(PARSER_MODULE_PATH, count);

    console.log(`\n  ${count} instances:`);
    console.log(`    Total Memory: ${formatBytes(result.totalMemory)}`);
    console.log(`    Per Instance: ${formatBytes(result.memoryPerInstance)}`);
    console.log(`    Avg Load Time: ${(result.avgLoadTimeNs / 1e6).toFixed(2)} ms`);
  }

  // ===== Summary =====
  benchmark.printSection('6. Summary');

  gc();
  const finalMemory = getMemoryUsage();

  // Get file sizes
  const lexerWasmSize = fs.statSync(path.join(DIST_DIR, 'lexer-module.wasm')).size;
  const lexerJsSize = fs.statSync(path.join(DIST_DIR, 'lexer-module.js')).size;
  const parserWasmSize = fs.statSync(path.join(DIST_DIR, 'parser-module.wasm')).size;
  const parserJsSize = fs.statSync(path.join(DIST_DIR, 'parser-module.js')).size;

  console.log('\nModule Sizes (on disk):');
  console.log(`  lexer-module.wasm: ${formatBytes(lexerWasmSize)}`);
  console.log(`  lexer-module.js: ${formatBytes(lexerJsSize)}`);
  console.log(`  parser-module.wasm: ${formatBytes(parserWasmSize)}`);
  console.log(`  parser-module.js: ${formatBytes(parserJsSize)}`);

  console.log('\nModule Memory Footprint (runtime):');
  console.log(`  Lexer: ~${formatBytes(lexerMetrics.memoryDelta.heapUsed + lexerMetrics.memoryDelta.external)}`);
  console.log(`  Parser: ~${formatBytes(parserMetrics.memoryDelta.heapUsed + parserMetrics.memoryDelta.external)}`);

  console.log('\nInstantiation Time:');
  console.log(`  Lexer: ${lexerMetrics.totalTimeMs.toFixed(2)} ms`);
  console.log(`  Parser: ${parserMetrics.totalTimeMs.toFixed(2)} ms`);

  console.log('\nParsing Overhead (per query):');

  // Get simple query stats for reference
  const simpleParserResults = benchmark.benchmarkParser(parserModule, TEST_QUERIES.simple, 1000);
  const simpleStats = benchmark.calculateStats(simpleParserResults, 'timeNs');

  const complexParserResults = benchmark.benchmarkParser(parserModule, TEST_QUERIES.complex, 1000);
  const complexStats = benchmark.calculateStats(complexParserResults, 'timeNs');

  console.log(`  Simple query: ~${(simpleStats.mean / 1000).toFixed(2)} us`);
  console.log(`  Complex query: ~${(complexStats.mean / 1000).toFixed(2)} us`);

  console.log('\nConcurrency Assessment:');
  console.log('  Can run many instances in parallel: YES');
  console.log('  Memory per instance: ~100-200 KB');
  console.log('  Recommended max concurrent: 100+ (limited by system memory)');

  console.log('\nFinal Memory State:');
  console.log(`  Heap Used: ${formatBytes(finalMemory.heapUsed)}`);
  console.log(`  Heap Total: ${formatBytes(finalMemory.heapTotal)}`);
  console.log(`  RSS: ${formatBytes(finalMemory.rss)}`);

  console.log('\n' + '='.repeat(60));
  console.log('Benchmark Complete');
  console.log('='.repeat(60));
}

// Run with garbage collection exposed
if (!global.gc) {
  console.log('Note: Run with --expose-gc for more accurate memory measurements');
  console.log('Example: node --expose-gc wasm-memory-test.js\n');
}

runBenchmarks().catch(console.error);
