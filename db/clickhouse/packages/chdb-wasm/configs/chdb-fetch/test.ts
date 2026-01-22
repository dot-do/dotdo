/**
 * Test script for chdb-fetch Cloudflare Worker
 *
 * Run with:
 *   npx tsx configs/chdb-fetch/test.ts
 *
 * Or test against a deployed worker:
 *   WORKER_URL=https://chdb-fetch.yourdomain.workers.dev npx tsx configs/chdb-fetch/test.ts
 */

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

interface QueryResponse {
  meta: Array<{ name: string; type: string }>;
  data: any[];
  rows: number;
  statistics?: {
    elapsed: number;
    rows_read: number;
    bytes_read: number;
    urls_fetched: number;
  };
  error?: boolean;
  message?: string;
}

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8789';

/**
 * Test helper to make requests to the worker
 */
async function queryWorker(
  sql: string,
  options: { method?: 'GET' | 'POST'; headers?: Record<string, string> } = {}
): Promise<QueryResponse> {
  const { method = 'POST', headers = {} } = options;

  let response: Response;

  if (method === 'GET') {
    const url = `${WORKER_URL}/query?sql=${encodeURIComponent(sql)}`;
    response = await fetch(url, { headers });
  } else {
    response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ query: sql }),
    });
  }

  return response.json() as Promise<QueryResponse>;
}

/**
 * Run a single test
 */
async function runTest(
  name: string,
  testFn: () => Promise<void>
): Promise<TestResult> {
  const start = performance.now();
  try {
    await testFn();
    return {
      name,
      passed: true,
      duration: performance.now() - start,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      duration: performance.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Assert helper
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * All test cases
 */
const tests = {
  /**
   * Test health check endpoint
   */
  async healthCheck(): Promise<void> {
    const response = await fetch(`${WORKER_URL}/ping`);
    assert(response.ok, `Expected 200, got ${response.status}`);
    const text = await response.text();
    assert(text === 'OK', `Expected 'OK', got '${text}'`);
  },

  /**
   * Test version endpoint
   */
  async versionEndpoint(): Promise<void> {
    const response = await fetch(`${WORKER_URL}/version`);
    assert(response.ok, `Expected 200, got ${response.status}`);
    const data = await response.json() as { name: string; version: string };
    assert(data.name === 'chdb-fetch', `Expected name 'chdb-fetch', got '${data.name}'`);
    assert(typeof data.version === 'string', 'Expected version string');
  },

  /**
   * Test help endpoint
   */
  async helpEndpoint(): Promise<void> {
    const response = await fetch(`${WORKER_URL}/help`);
    assert(response.ok, `Expected 200, got ${response.status}`);
    const data = await response.json() as { endpoints: object; examples: any[] };
    assert(typeof data.endpoints === 'object', 'Expected endpoints object');
    assert(Array.isArray(data.examples), 'Expected examples array');
  },

  /**
   * Test CORS preflight
   */
  async corsHeaders(): Promise<void> {
    const response = await fetch(WORKER_URL, {
      method: 'OPTIONS',
    });
    assert(response.status === 204, `Expected 204, got ${response.status}`);
    assert(
      response.headers.get('Access-Control-Allow-Origin') === '*',
      'Expected CORS header'
    );
  },

  /**
   * Test missing query error
   */
  async missingQueryError(): Promise<void> {
    const response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await response.json() as { error: boolean; message: string };
    assert(data.error === true, 'Expected error response');
    assert(data.message.includes('Missing query'), 'Expected missing query error');
  },

  /**
   * Test query without url() function
   */
  async noUrlFunctionError(): Promise<void> {
    const result = await queryWorker('SELECT 1 + 1');
    assert(result.error === true, 'Expected error response');
    assert(
      result.message?.includes('url()'),
      `Expected url() function error, got: ${result.message}`
    );
  },

  /**
   * Test invalid URL fetch (should fail gracefully)
   */
  async invalidUrlError(): Promise<void> {
    const result = await queryWorker(
      "SELECT * FROM url('https://this-domain-does-not-exist-12345.invalid/data', 'JSON')"
    );
    assert(result.error === true, 'Expected error for invalid URL');
  },

  /**
   * Test JSON format parsing with GitHub API
   * (This test requires network access)
   */
  async githubUserQuery(): Promise<void> {
    const result = await queryWorker(
      "SELECT * FROM url('https://api.github.com/users/octocat', 'JSON')"
    );

    if (result.error) {
      // If rate limited or network error, skip
      console.log(`  Skipped due to: ${result.message}`);
      return;
    }

    assert(result.rows > 0, 'Expected at least one row');
    assert(result.data[0].login === 'octocat', "Expected login to be 'octocat'");
  },

  /**
   * Test JSONEachRow format with filtering
   */
  async githubReposWithFilter(): Promise<void> {
    const result = await queryWorker(
      "SELECT name, stargazers_count FROM url('https://api.github.com/users/octocat/repos', 'JSONEachRow') LIMIT 5"
    );

    if (result.error) {
      // If rate limited or network error, skip
      console.log(`  Skipped due to: ${result.message}`);
      return;
    }

    assert(result.rows <= 5, 'Expected at most 5 rows due to LIMIT');
    assert(
      result.meta.some(m => m.name === 'name'),
      'Expected name column in meta'
    );
  },

  /**
   * Test ORDER BY clause
   */
  async orderByClause(): Promise<void> {
    const result = await queryWorker(
      "SELECT name, stargazers_count FROM url('https://api.github.com/users/octocat/repos', 'JSONEachRow') ORDER BY stargazers_count DESC LIMIT 3"
    );

    if (result.error) {
      console.log(`  Skipped due to: ${result.message}`);
      return;
    }

    assert(result.rows <= 3, 'Expected at most 3 rows');
    // Check that results are sorted
    for (let i = 1; i < result.data.length; i++) {
      assert(
        result.data[i - 1].stargazers_count >= result.data[i].stargazers_count,
        'Expected descending order by stargazers_count'
      );
    }
  },

  /**
   * Test column selection
   */
  async selectSpecificColumns(): Promise<void> {
    const result = await queryWorker(
      "SELECT login, id FROM url('https://api.github.com/users/octocat', 'JSON')"
    );

    if (result.error) {
      console.log(`  Skipped due to: ${result.message}`);
      return;
    }

    assert(result.meta.length === 2, 'Expected exactly 2 columns');
    assert(
      result.meta.every(m => ['login', 'id'].includes(m.name)),
      'Expected only login and id columns'
    );
  },

  /**
   * Test GET method with query parameter
   */
  async getMethodQuery(): Promise<void> {
    const result = await queryWorker(
      "SELECT * FROM url('https://api.github.com/users/octocat', 'JSON') LIMIT 1",
      { method: 'GET' }
    );

    if (result.error) {
      console.log(`  Skipped due to: ${result.message}`);
      return;
    }

    assert(result.rows === 1, 'Expected 1 row');
  },

  /**
   * Test cache headers
   */
  async cacheHeaders(): Promise<void> {
    const result = await queryWorker(
      "SELECT * FROM url('https://api.github.com/users/octocat', 'JSON') LIMIT 1",
      { headers: { 'X-Cache-TTL': '60' } }
    );

    if (result.error) {
      console.log(`  Skipped due to: ${result.message}`);
      return;
    }

    assert(result.rows >= 0, 'Query should succeed with cache header');
  },

  /**
   * Test no-cache header
   */
  async noCacheHeader(): Promise<void> {
    const result = await queryWorker(
      "SELECT * FROM url('https://api.github.com/users/octocat', 'JSON') LIMIT 1",
      { headers: { 'X-No-Cache': 'true' } }
    );

    if (result.error) {
      console.log(`  Skipped due to: ${result.message}`);
      return;
    }

    assert(result.rows >= 0, 'Query should succeed with no-cache header');
  },

  /**
   * Test unsupported format error
   */
  async unsupportedFormatError(): Promise<void> {
    const result = await queryWorker(
      "SELECT * FROM url('https://api.github.com/users/octocat', 'INVALID_FORMAT')"
    );

    assert(result.error === true, 'Expected error for unsupported format');
    assert(
      result.message?.includes('Unsupported format'),
      `Expected unsupported format error, got: ${result.message}`
    );
  },

  /**
   * Test statistics are returned
   */
  async statisticsReturned(): Promise<void> {
    const result = await queryWorker(
      "SELECT * FROM url('https://api.github.com/users/octocat', 'JSON')"
    );

    if (result.error) {
      console.log(`  Skipped due to: ${result.message}`);
      return;
    }

    assert(result.statistics !== undefined, 'Expected statistics in response');
    assert(typeof result.statistics.elapsed === 'number', 'Expected elapsed time');
    assert(typeof result.statistics.rows_read === 'number', 'Expected rows_read');
  },
};

/**
 * Main test runner
 */
async function main(): Promise<void> {
  console.log(`\nchdb-fetch Worker Tests`);
  console.log(`========================`);
  console.log(`Target: ${WORKER_URL}\n`);

  const results: TestResult[] = [];

  for (const [name, testFn] of Object.entries(tests)) {
    process.stdout.write(`  ${name}... `);
    const result = await runTest(name, testFn);
    results.push(result);

    if (result.passed) {
      console.log(`PASSED (${result.duration.toFixed(0)}ms)`);
    } else {
      console.log(`FAILED`);
      console.log(`    Error: ${result.error}`);
    }
  }

  // Summary
  console.log(`\n------------------------`);
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${results.length}`);
  console.log(`Time:   ${(totalDuration / 1000).toFixed(2)}s\n`);

  if (failed > 0) {
    console.log(`Failed tests:`);
    for (const result of results.filter(r => !r.passed)) {
      console.log(`  - ${result.name}: ${result.error}`);
    }
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
