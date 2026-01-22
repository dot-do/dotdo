#!/usr/bin/env npx tsx
/**
 * verify-deployment.ts
 *
 * Comprehensive deployment verification script for chDB WASM Workers.
 *
 * This script verifies:
 * - /ping endpoint health
 * - SQL query execution
 * - Response format validation
 * - Latency measurements
 * - Error handling
 *
 * Usage:
 *   npx tsx scripts/verify-deployment.ts --url <worker-url>
 *   npx tsx scripts/verify-deployment.ts --url https://chdb-wasm.dotdo.workers.dev
 *   npx tsx scripts/verify-deployment.ts --config chdb-fetch --env staging
 */

import { parseArgs } from 'node:util';

// ============================================================================
// Types
// ============================================================================

interface VerificationResult {
  name: string;
  passed: boolean;
  latencyMs: number;
  details?: string;
  error?: string;
}

interface VerificationReport {
  url: string;
  config: string;
  environment: string;
  timestamp: string;
  results: VerificationResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    avgLatencyMs: number;
  };
}

interface QueryResponse {
  meta: Array<{ name: string; type: string }>;
  data: any[];
  rows: number;
  statistics?: {
    elapsed: number;
    rows_read: number;
    bytes_read: number;
  };
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_TIMEOUT_MS = 30000;
const LATENCY_THRESHOLD_MS = 5000; // Warn if latency exceeds this

// Worker URL patterns
const WORKER_URL_PATTERNS: Record<string, Record<string, string>> = {
  'chdb-fetch': {
    staging: 'https://chdb-fetch-staging.dotdo.workers.dev',
    production: 'https://chdb-fetch.dotdo.workers.dev',
  },
  'chdb-lake': {
    staging: 'https://chdb-lake-staging.dotdo.workers.dev',
    production: 'https://chdb-lake.dotdo.workers.dev',
  },
  'chdb-wasm': {
    staging: 'https://chdb-wasm-staging.dotdo.workers.dev',
    production: 'https://chdb-wasm.dotdo.workers.dev',
  },
};

// ============================================================================
// Color Output
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(message: string): void {
  console.log(message);
}

function logInfo(message: string): void {
  console.log(`${colors.blue}[INFO]${colors.reset} ${message}`);
}

function logSuccess(message: string): void {
  console.log(`${colors.green}[PASS]${colors.reset} ${message}`);
}

function logError(message: string): void {
  console.log(`${colors.red}[FAIL]${colors.reset} ${message}`);
}

function logWarn(message: string): void {
  console.log(`${colors.yellow}[WARN]${colors.reset} ${message}`);
}

function logSection(title: string): void {
  console.log('');
  console.log(`${colors.cyan}${colors.bold}=== ${title} ===${colors.reset}`);
  console.log('');
}

// ============================================================================
// HTTP Utilities
// ============================================================================

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function measureLatency<T>(
  fn: () => Promise<T>
): Promise<{ result: T; latencyMs: number }> {
  const start = performance.now();
  const result = await fn();
  const latencyMs = Math.round(performance.now() - start);
  return { result, latencyMs };
}

// ============================================================================
// Verification Tests
// ============================================================================

async function verifyPing(baseUrl: string): Promise<VerificationResult> {
  const testName = 'Ping Endpoint';

  try {
    const { result: response, latencyMs } = await measureLatency(() =>
      fetchWithTimeout(`${baseUrl}/ping`)
    );

    if (!response.ok) {
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const body = await response.text();
    const expected = 'Ok.\n';

    if (body !== expected && body !== 'Ok.') {
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: `Unexpected response body: "${body}"`,
      };
    }

    return {
      name: testName,
      passed: true,
      latencyMs,
      details: `Response: ${body.trim()}`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifySimpleQuery(baseUrl: string): Promise<VerificationResult> {
  const testName = 'Simple Arithmetic Query';
  const query = 'SELECT 1 + 1 AS result';

  try {
    const url = `${baseUrl}/?query=${encodeURIComponent(query)}&default_format=JSON`;
    const { result: response, latencyMs } = await measureLatency(() =>
      fetchWithTimeout(url)
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const data: QueryResponse = await response.json();

    if (!data.data || data.data.length === 0) {
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: 'Empty result set',
      };
    }

    const result = data.data[0].result;
    if (result !== 2) {
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: `Expected 2, got ${result}`,
      };
    }

    return {
      name: testName,
      passed: true,
      latencyMs,
      details: `Result: ${result}`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifySystemFunctions(baseUrl: string): Promise<VerificationResult> {
  const testName = 'System Functions';
  const query = 'SELECT version() AS ver, currentDatabase() AS db';

  try {
    const url = `${baseUrl}/?query=${encodeURIComponent(query)}&default_format=JSON`;
    const { result: response, latencyMs } = await measureLatency(() =>
      fetchWithTimeout(url)
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const data: QueryResponse = await response.json();

    if (!data.data || data.data.length === 0) {
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: 'Empty result set',
      };
    }

    const { ver, db } = data.data[0];

    if (!ver) {
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: 'version() returned null',
      };
    }

    return {
      name: testName,
      passed: true,
      latencyMs,
      details: `Version: ${ver}, Database: ${db}`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifyJsonFormat(baseUrl: string): Promise<VerificationResult> {
  const testName = 'JSON Response Format';
  const query = "SELECT 'hello' AS greeting, 42 AS number";

  try {
    const url = `${baseUrl}/?query=${encodeURIComponent(query)}&default_format=JSON`;
    const { result: response, latencyMs } = await measureLatency(() =>
      fetchWithTimeout(url)
    );

    if (!response.ok) {
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: `HTTP ${response.status}`,
      };
    }

    const data: QueryResponse = await response.json();

    // Verify JSON structure
    const hasRequiredFields =
      Array.isArray(data.meta) &&
      Array.isArray(data.data) &&
      typeof data.rows === 'number';

    if (!hasRequiredFields) {
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: 'Missing required fields in JSON response',
      };
    }

    // Verify meta has column info
    if (data.meta.length !== 2) {
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: `Expected 2 columns in meta, got ${data.meta.length}`,
      };
    }

    // Verify data values
    if (data.data[0].greeting !== 'hello' || data.data[0].number !== 42) {
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: 'Incorrect data values',
      };
    }

    return {
      name: testName,
      passed: true,
      latencyMs,
      details: `Meta columns: ${data.meta.map(m => m.name).join(', ')}`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifyCors(baseUrl: string): Promise<VerificationResult> {
  const testName = 'CORS Headers';

  try {
    const { result: response, latencyMs } = await measureLatency(() =>
      fetchWithTimeout(`${baseUrl}/ping`, {
        method: 'OPTIONS',
      })
    );

    const corsOrigin = response.headers.get('Access-Control-Allow-Origin');
    const corsMethods = response.headers.get('Access-Control-Allow-Methods');

    if (!corsOrigin) {
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: 'Missing Access-Control-Allow-Origin header',
      };
    }

    return {
      name: testName,
      passed: true,
      latencyMs,
      details: `Origin: ${corsOrigin}, Methods: ${corsMethods || 'not set'}`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifyErrorHandling(baseUrl: string): Promise<VerificationResult> {
  const testName = 'Error Handling';
  const invalidQuery = 'INVALID SQL SYNTAX HERE';

  try {
    const url = `${baseUrl}/?query=${encodeURIComponent(invalidQuery)}&default_format=JSON`;
    const { result: response, latencyMs } = await measureLatency(() =>
      fetchWithTimeout(url)
    );

    // Should return an error status (400 or 500)
    if (response.ok) {
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: 'Invalid query should have returned an error status',
      };
    }

    const errorText = await response.text();

    // Verify error message contains useful information
    if (!errorText.includes('error') && !errorText.includes('Error') && !errorText.includes('Syntax')) {
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: 'Error response does not contain descriptive message',
      };
    }

    return {
      name: testName,
      passed: true,
      latencyMs,
      details: `HTTP ${response.status}: Error properly returned`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifyLatencyUnderThreshold(baseUrl: string): Promise<VerificationResult> {
  const testName = 'Latency Threshold';
  const query = 'SELECT 1';
  const iterations = 3;
  const latencies: number[] = [];

  try {
    for (let i = 0; i < iterations; i++) {
      const url = `${baseUrl}/?query=${encodeURIComponent(query)}&default_format=JSON`;
      const { latencyMs } = await measureLatency(() => fetchWithTimeout(url));
      latencies.push(latencyMs);
    }

    const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / iterations);
    const maxLatency = Math.max(...latencies);

    if (maxLatency > LATENCY_THRESHOLD_MS) {
      return {
        name: testName,
        passed: false,
        latencyMs: avgLatency,
        error: `Max latency ${maxLatency}ms exceeds threshold ${LATENCY_THRESHOLD_MS}ms`,
      };
    }

    return {
      name: testName,
      passed: true,
      latencyMs: avgLatency,
      details: `Avg: ${avgLatency}ms, Max: ${maxLatency}ms (threshold: ${LATENCY_THRESHOLD_MS}ms)`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifyStatusEndpoint(baseUrl: string): Promise<VerificationResult> {
  const testName = 'Status Endpoint';

  try {
    const { result: response, latencyMs } = await measureLatency(() =>
      fetchWithTimeout(`${baseUrl}/status`)
    );

    if (!response.ok) {
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: `HTTP ${response.status}`,
      };
    }

    const data = await response.json();

    // Verify status response structure
    if (!data.service || !data.version || !data.timestamp) {
      return {
        name: testName,
        passed: false,
        latencyMs,
        error: 'Missing required fields in status response',
      };
    }

    return {
      name: testName,
      passed: true,
      latencyMs,
      details: `Service: ${data.service}, Version: ${data.version}`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Main Verification Runner
// ============================================================================

async function runVerification(
  url: string,
  config: string,
  environment: string
): Promise<VerificationReport> {
  const results: VerificationResult[] = [];

  logSection('Running Verification Tests');
  logInfo(`URL: ${url}`);
  logInfo(`Config: ${config}`);
  logInfo(`Environment: ${environment}`);
  console.log('');

  // Run all verification tests
  const tests = [
    verifyPing,
    verifySimpleQuery,
    verifySystemFunctions,
    verifyJsonFormat,
    verifyCors,
    verifyErrorHandling,
    verifyLatencyUnderThreshold,
    verifyStatusEndpoint,
  ];

  for (const test of tests) {
    const result = await test(url);
    results.push(result);

    if (result.passed) {
      logSuccess(`${result.name} (${result.latencyMs}ms) - ${result.details || 'OK'}`);
    } else {
      logError(`${result.name} (${result.latencyMs}ms) - ${result.error}`);
    }

    // Warn on high latency
    if (result.passed && result.latencyMs > LATENCY_THRESHOLD_MS / 2) {
      logWarn(`  High latency: ${result.latencyMs}ms`);
    }
  }

  // Calculate summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const avgLatency = Math.round(
    results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length
  );

  const report: VerificationReport = {
    url,
    config,
    environment,
    timestamp: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      passed,
      failed,
      avgLatencyMs: avgLatency,
    },
  };

  return report;
}

function printReport(report: VerificationReport): void {
  logSection('Verification Summary');

  console.log(`${colors.bold}URL:${colors.reset}         ${report.url}`);
  console.log(`${colors.bold}Config:${colors.reset}      ${report.config}`);
  console.log(`${colors.bold}Environment:${colors.reset} ${report.environment}`);
  console.log(`${colors.bold}Timestamp:${colors.reset}   ${report.timestamp}`);
  console.log('');
  console.log(`${colors.bold}Results:${colors.reset}`);
  console.log(`  Total:   ${report.summary.total}`);
  console.log(`  ${colors.green}Passed:  ${report.summary.passed}${colors.reset}`);
  console.log(`  ${colors.red}Failed:  ${report.summary.failed}${colors.reset}`);
  console.log(`  Avg Latency: ${report.summary.avgLatencyMs}ms`);
  console.log('');

  if (report.summary.failed > 0) {
    console.log(`${colors.red}${colors.bold}VERIFICATION FAILED${colors.reset}`);
    console.log('');
    console.log('Failed tests:');
    for (const result of report.results.filter(r => !r.passed)) {
      console.log(`  - ${result.name}: ${result.error}`);
    }
  } else {
    console.log(`${colors.green}${colors.bold}VERIFICATION PASSED${colors.reset}`);
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs({
    options: {
      url: { type: 'string', short: 'u' },
      config: { type: 'string', short: 'c' },
      env: { type: 'string', short: 'e' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (args.values.help) {
    console.log(`
Usage: npx tsx verify-deployment.ts [options]

Options:
  --url, -u <url>      Worker URL to verify
  --config, -c <name>  Configuration name (chdb-fetch, chdb-lake, chdb-wasm)
  --env, -e <env>      Environment (staging, production)
  --json               Output results as JSON
  --help, -h           Show this help message

Examples:
  npx tsx verify-deployment.ts --url https://chdb-wasm.dotdo.workers.dev
  npx tsx verify-deployment.ts --config chdb-fetch --env staging
  npx tsx verify-deployment.ts --url https://my-worker.dev --json
`);
    process.exit(0);
  }

  let url = args.values.url;
  const config = args.values.config || 'chdb-wasm';
  const environment = args.values.env || 'staging';
  const outputJson = args.values.json || false;

  // Resolve URL from config/env if not provided
  if (!url) {
    const configUrls = WORKER_URL_PATTERNS[config];
    if (!configUrls) {
      console.error(`Unknown config: ${config}`);
      console.error(`Available configs: ${Object.keys(WORKER_URL_PATTERNS).join(', ')}`);
      process.exit(1);
    }

    url = configUrls[environment];
    if (!url) {
      console.error(`Unknown environment: ${environment}`);
      console.error(`Available environments: ${Object.keys(configUrls).join(', ')}`);
      process.exit(1);
    }
  }

  console.log('');
  console.log(`${colors.bold}================================================================${colors.reset}`);
  console.log(`${colors.bold}  chDB WASM Deployment Verification${colors.reset}`);
  console.log(`${colors.bold}================================================================${colors.reset}`);

  try {
    const report = await runVerification(url, config, environment);

    if (outputJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }

    // Exit with error code if any tests failed
    process.exit(report.summary.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('');
    console.error(`${colors.red}Verification failed with error:${colors.reset}`);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
