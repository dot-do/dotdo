/**
 * WebSocket Subrequest Limit Test
 *
 * Tests the hypothesis that Cloudflare Workers' 1,000 subrequest limit
 * resets after each incoming WebSocket message, not per connection lifetime.
 *
 * HYPOTHESIS: Limit resets per message
 * - If true: Single WebSocket connection = unlimited subrequests over time
 * - If false: Need to close/reopen connections for long-running analytics
 *
 * TEST METHODOLOGY:
 * 1. Connect to DO via WebSocket
 * 2. Send 10 messages, each triggering 200 KV subrequests
 * 3. If all 2,000 subrequests succeed -> limit resets per message
 * 4. If fails around 1,000 total -> limit is per connection
 *
 * RELATED:
 * - Issue: dotdo-wlh7b
 * - Architecture: docs/plans/unified-analytics-architecture.md
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

/**
 * NOTE: This test requires a running worker.
 * Run with: wrangler dev --config wrangler.subrequest-test.jsonc
 *
 * For automated testing in CI, use:
 * npx wrangler dev --config wrangler.subrequest-test.jsonc &
 * Then run the test.
 */

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787'
const WS_URL = WORKER_URL.replace('http', 'ws') + '/ws'

interface TestResult {
  messageNumber: number
  subrequestsAttempted: number
  subrequestsSucceeded: number
  subrequestsFailed: number
  cumulativeTotal: number
  firstError?: string
  durationMs: number
}

interface TestSummary {
  type: 'summary'
  totalMessages: number
  totalSubrequests: number
  connectionDurationMs: number
  results: TestResult[]
  conclusion: {
    hypothesis: string
    confirmed: boolean
    explanation: string
    subrequestBehavior: string
  }
}

/**
 * Helper to create a WebSocket connection and run the test sequence
 */
async function runSubrequestTest(options: {
  messageCount: number
  subrequestsPerMessage: number
  timeoutMs?: number
}): Promise<TestSummary> {
  const { messageCount, subrequestsPerMessage, timeoutMs = 120000 } = options

  return new Promise((resolve, reject) => {
    // Use dynamic import for WebSocket in Node.js
    import('ws').then(({ default: WebSocket }) => {
      const ws = new WebSocket(WS_URL)
      const results: TestResult[] = []
      let messagesSent = 0

      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error(`Test timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      ws.on('open', () => {
        console.log('WebSocket connected')
      })

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString())

          if (msg.type === 'connected') {
            console.log('Connection acknowledged, starting test...')
            // Send first test message
            ws.send(JSON.stringify({
              action: 'test',
              subrequestCount: subrequestsPerMessage,
            }))
            messagesSent++
          } else if (msg.type === 'result') {
            console.log(
              `Message ${msg.messageNumber}: ${msg.subrequestsSucceeded}/${msg.subrequestsAttempted} succeeded ` +
              `(cumulative: ${msg.cumulativeTotal}, ${msg.durationMs.toFixed(1)}ms)`
            )
            results.push(msg as TestResult)

            if (messagesSent < messageCount) {
              // Send next test message
              ws.send(JSON.stringify({
                action: 'test',
                subrequestCount: subrequestsPerMessage,
              }))
              messagesSent++
            } else {
              // Request summary
              ws.send(JSON.stringify({ action: 'summary' }))
            }
          } else if (msg.type === 'summary') {
            clearTimeout(timeout)
            ws.close()
            resolve(msg as TestSummary)
          } else if (msg.type === 'error') {
            console.error('Server error:', msg.error)
          }
        } catch (error) {
          console.error('Failed to parse message:', error)
        }
      })

      ws.on('error', (error: Error) => {
        clearTimeout(timeout)
        reject(error)
      })

      ws.on('close', () => {
        console.log('WebSocket closed')
      })
    }).catch(reject)
  })
}

/**
 * Helper to run HTTP test for comparison
 */
async function runHttpTest(count: number): Promise<{
  succeeded: number
  failed: number
  firstError?: string
  durationMs: number
}> {
  const response = await fetch(`${WORKER_URL}/http-test?count=${count}`)
  return response.json()
}

/**
 * Helper to run DO-to-DO RPC test
 */
async function runRpcTest(calls: number, perCall: number): Promise<{
  totalDOCalls: number
  totalInternalSubrequests: number
  results: Array<{
    callNumber: number
    targetDOSubrequests: number
    success: boolean
    error?: string
  }>
  analysis: {
    question: string
    answer: string
  }
}> {
  const response = await fetch(`${WORKER_URL}/rpc-test?calls=${calls}&perCall=${perCall}`)
  return response.json()
}

describe.skip('WebSocket Subrequest Limit', () => {
  // Skip by default - requires running worker
  // Remove .skip when testing manually

  beforeAll(async () => {
    // Check if worker is running
    try {
      const response = await fetch(`${WORKER_URL}/health`)
      const data = await response.json()
      if (data.status !== 'ok') {
        throw new Error('Worker not healthy')
      }
    } catch (error) {
      console.error(`
=======================================================
SETUP REQUIRED: Worker not running at ${WORKER_URL}

Start the worker with:
  cd packages/duckdb-worker
  npx wrangler dev --config wrangler.subrequest-test.jsonc

Then run this test again.
=======================================================
`)
      throw error
    }
  })

  it('should confirm or deny per-message limit reset', async () => {
    const summary = await runSubrequestTest({
      messageCount: 10,
      subrequestsPerMessage: 200,
      timeoutMs: 180000, // 3 minutes
    })

    console.log('\n========== TEST RESULTS ==========')
    console.log(`Total messages: ${summary.totalMessages}`)
    console.log(`Total subrequests: ${summary.totalSubrequests}`)
    console.log(`Duration: ${summary.connectionDurationMs}ms`)
    console.log(`\nConclusion:`)
    console.log(`  Hypothesis: ${summary.conclusion.hypothesis}`)
    console.log(`  Confirmed: ${summary.conclusion.confirmed}`)
    console.log(`  Behavior: ${summary.conclusion.subrequestBehavior}`)
    console.log(`  Explanation: ${summary.conclusion.explanation}`)
    console.log('==================================\n')

    // The test passes regardless of which behavior is confirmed
    // The goal is to document the behavior
    expect(summary.conclusion.confirmed).toBe(true)
    expect(['PER_MESSAGE_RESET', 'PER_CONNECTION_LIMIT']).toContain(
      summary.conclusion.subrequestBehavior
    )
  }, 200000)

  it('should test HTTP subrequest behavior for comparison', async () => {
    // HTTP requests should have their own 1,000 limit
    const result = await runHttpTest(500)

    console.log('\n========== HTTP TEST RESULTS ==========')
    console.log(`Attempted: 500 subrequests`)
    console.log(`Succeeded: ${result.succeeded}`)
    console.log(`Failed: ${result.failed}`)
    console.log(`Duration: ${result.durationMs}ms`)
    if (result.firstError) {
      console.log(`First error: ${result.firstError}`)
    }
    console.log('========================================\n')

    // 500 should be well under the 1,000 limit
    expect(result.succeeded).toBeGreaterThan(450)
  }, 60000)

  it('should test DO-to-DO RPC subrequest counting', async () => {
    // Test if DO-to-DO calls count as 1 subrequest each
    const result = await runRpcTest(5, 100)

    console.log('\n========== RPC TEST RESULTS ==========')
    console.log(`DO calls made: ${result.totalDOCalls}`)
    console.log(`Internal subrequests (across all DOs): ${result.totalInternalSubrequests}`)
    console.log(`\nPer-call breakdown:`)
    for (const r of result.results) {
      console.log(`  Call ${r.callNumber}: ${r.targetDOSubrequests} subrequests, success: ${r.success}`)
      if (r.error) console.log(`    Error: ${r.error}`)
    }
    console.log(`\nAnalysis:`)
    console.log(`  Question: ${result.analysis.question}`)
    console.log(`  Answer: ${result.analysis.answer}`)
    console.log('========================================\n')

    // All calls should succeed
    expect(result.results.every((r) => r.success)).toBe(true)
  }, 60000)
})

/**
 * Manual test runner - can be executed directly
 *
 * Usage:
 *   npx tsx packages/duckdb-worker/tests/ws-subrequest-limit.test.ts
 */
if (process.argv[1]?.includes('ws-subrequest-limit')) {
  console.log('Running WebSocket Subrequest Limit Test manually...\n')
  console.log(`Worker URL: ${WORKER_URL}`)
  console.log(`WebSocket URL: ${WS_URL}\n`)

  async function main() {
    try {
      // Check health first
      console.log('Checking worker health...')
      const health = await fetch(`${WORKER_URL}/health`)
      if (!health.ok) {
        throw new Error(`Worker not available: ${health.status}`)
      }
      console.log('Worker is healthy\n')

      // Run main WebSocket test
      console.log('Starting WebSocket subrequest test...')
      console.log('(10 messages x 200 subrequests = 2000 total)\n')

      const summary = await runSubrequestTest({
        messageCount: 10,
        subrequestsPerMessage: 200,
        timeoutMs: 180000,
      })

      console.log('\n' + '='.repeat(60))
      console.log('FINAL RESULTS')
      console.log('='.repeat(60))
      console.log(JSON.stringify(summary.conclusion, null, 2))
      console.log('='.repeat(60) + '\n')

      // Run HTTP comparison test
      console.log('Running HTTP comparison test (500 subrequests)...')
      const httpResult = await runHttpTest(500)
      console.log(`HTTP: ${httpResult.succeeded}/${500} succeeded\n`)

      // Run RPC test
      console.log('Running DO-to-DO RPC test (5 calls x 100 subrequests)...')
      const rpcResult = await runRpcTest(5, 100)
      console.log(`RPC: ${rpcResult.totalInternalSubrequests} internal subrequests across ${rpcResult.totalDOCalls} DO calls`)
      console.log(`Analysis: ${rpcResult.analysis.answer}\n`)

    } catch (error) {
      console.error('Test failed:', error)
      process.exit(1)
    }
  }

  main()
}
