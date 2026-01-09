/**
 * WebSocket Subrequest Limit Test
 *
 * HYPOTHESIS: The Cloudflare Workers 1,000 subrequest limit resets after each
 * incoming WebSocket message, not per connection lifetime.
 *
 * TEST APPROACH:
 * 1. Accept WebSocket connections
 * 2. On each incoming message, make 200 subrequests to KV
 * 3. Track total subrequests made across all messages
 * 4. If 10 messages x 200 subrequests = 2000 total succeeds -> limit resets per message
 * 5. If fails around 1000 total -> limit is per connection
 *
 * REFERENCE: Issue dotdo-wlh7b
 *
 * FINDINGS (to be updated after testing):
 * - [ ] Per-message reset confirmed/denied
 * - [ ] Exact subrequest counting behavior documented
 * - [ ] DO-to-DO RPC subrequest counting behavior
 *
 * @see https://developers.cloudflare.com/workers/platform/limits/#subrequests
 */

import { DurableObject } from 'cloudflare:workers'

export interface SubrequestTestEnv {
  CACHE: KVNamespace
  SUBREQUEST_TEST: DurableObjectNamespace<SubrequestTestDO>
  SECONDARY_DO?: DurableObjectNamespace<SubrequestTestDO>
}

interface MessageResult {
  messageNumber: number
  subrequestsAttempted: number
  subrequestsSucceeded: number
  subrequestsFailed: number
  cumulativeTotal: number
  firstError?: string
  durationMs: number
}

interface TestState {
  totalSubrequests: number
  messageCount: number
  results: MessageResult[]
  startTime: number
}

/**
 * Durable Object for testing WebSocket subrequest limits
 *
 * This DO accepts WebSocket connections and makes many KV requests
 * per incoming message to test if the 1,000 subrequest limit
 * resets per message or is per connection lifetime.
 */
export class SubrequestTestDO extends DurableObject<SubrequestTestEnv> {
  private testState: TestState | null = null
  private webSockets: Map<WebSocket, TestState> = new Map()

  /**
   * Handle incoming fetch requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', type: 'SubrequestTestDO' })
    }

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      return this.handleWebSocketUpgrade(request)
    }

    // HTTP test endpoint (for comparison)
    if (url.pathname === '/http-test') {
      return this.handleHttpTest(request)
    }

    // DO-to-DO RPC test
    if (url.pathname === '/rpc-test') {
      return this.handleRpcTest(request)
    }

    // Make subrequests (for DO-to-DO testing)
    if (url.pathname === '/make-subrequests') {
      const count = parseInt(url.searchParams.get('count') || '100', 10)
      const result = await this.makeSubrequests(count)
      return Response.json(result)
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  /**
   * Handle WebSocket upgrade request
   */
  private handleWebSocketUpgrade(request: Request): Response {
    const upgradeHeader = request.headers.get('upgrade')
    if (upgradeHeader?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // Initialize test state for this connection
    const state: TestState = {
      totalSubrequests: 0,
      messageCount: 0,
      results: [],
      startTime: Date.now(),
    }
    this.webSockets.set(server, state)

    // Accept the WebSocket
    server.accept()

    // Send connection acknowledgment
    server.send(JSON.stringify({
      type: 'connected',
      message: 'WebSocket subrequest test ready',
      info: {
        subrequestsPerMessage: 200,
        expectedMessages: 10,
        totalExpected: 2000,
        hypothesis: 'limit resets per message',
      },
    }))

    // Handle incoming messages
    server.addEventListener('message', async (event) => {
      const wsState = this.webSockets.get(server)
      if (!wsState) return

      try {
        const data = JSON.parse(event.data as string)
        await this.handleWebSocketMessage(server, wsState, data)
      } catch (error) {
        server.send(JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        }))
      }
    })

    // Handle close
    server.addEventListener('close', () => {
      const wsState = this.webSockets.get(server)
      if (wsState) {
        console.log(`WebSocket closed. Total subrequests: ${wsState.totalSubrequests}`)
        this.webSockets.delete(server)
      }
    })

    // Handle error
    server.addEventListener('error', (event) => {
      console.error('WebSocket error:', event)
      this.webSockets.delete(server)
    })

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  /**
   * Handle a WebSocket message by making subrequests
   */
  private async handleWebSocketMessage(
    ws: WebSocket,
    state: TestState,
    data: { action: string; subrequestCount?: number }
  ): Promise<void> {
    if (data.action === 'test') {
      const count = data.subrequestCount || 200
      state.messageCount++

      const result = await this.makeSubrequests(count)

      state.totalSubrequests += result.succeeded
      state.results.push({
        messageNumber: state.messageCount,
        subrequestsAttempted: count,
        subrequestsSucceeded: result.succeeded,
        subrequestsFailed: result.failed,
        cumulativeTotal: state.totalSubrequests,
        firstError: result.firstError,
        durationMs: result.durationMs,
      })

      ws.send(JSON.stringify({
        type: 'result',
        ...state.results[state.results.length - 1],
      }))
    } else if (data.action === 'summary') {
      ws.send(JSON.stringify({
        type: 'summary',
        totalMessages: state.messageCount,
        totalSubrequests: state.totalSubrequests,
        connectionDurationMs: Date.now() - state.startTime,
        results: state.results,
        conclusion: this.analyzeResults(state),
      }))
    } else if (data.action === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
    }
  }

  /**
   * Make N subrequests to KV to test the limit
   */
  private async makeSubrequests(count: number): Promise<{
    succeeded: number
    failed: number
    firstError?: string
    durationMs: number
  }> {
    const startTime = performance.now()
    let succeeded = 0
    let failed = 0
    let firstError: string | undefined

    // Make requests in batches to avoid overwhelming
    const batchSize = 50
    for (let i = 0; i < count; i += batchSize) {
      const batchCount = Math.min(batchSize, count - i)
      const promises: Promise<void>[] = []

      for (let j = 0; j < batchCount; j++) {
        const key = `test-${Date.now()}-${i + j}-${Math.random()}`
        promises.push(
          this.env.CACHE.put(key, 'test-value', { expirationTtl: 60 })
            .then(() => { succeeded++ })
            .catch((error) => {
              failed++
              if (!firstError) {
                firstError = error instanceof Error ? error.message : String(error)
              }
            })
        )
      }

      await Promise.all(promises)

      // If we hit errors, stop early
      if (firstError && failed > 5) {
        break
      }
    }

    return {
      succeeded,
      failed,
      firstError,
      durationMs: performance.now() - startTime,
    }
  }

  /**
   * Analyze test results to determine if hypothesis is confirmed
   */
  private analyzeResults(state: TestState): {
    hypothesis: string
    confirmed: boolean
    explanation: string
    subrequestBehavior: string
  } {
    const totalAttempted = state.results.reduce((sum, r) => sum + r.subrequestsAttempted, 0)
    const totalSucceeded = state.totalSubrequests
    const hadErrors = state.results.some((r) => r.subrequestsFailed > 0)

    if (totalSucceeded >= 1500 && !hadErrors) {
      return {
        hypothesis: 'Limit resets per WebSocket message',
        confirmed: true,
        explanation: `Successfully made ${totalSucceeded} subrequests across ${state.messageCount} messages. ` +
          'This exceeds the 1,000 limit, confirming the limit resets per message.',
        subrequestBehavior: 'PER_MESSAGE_RESET',
      }
    } else if (totalSucceeded <= 1050 && hadErrors) {
      // Find where errors started
      const errorMessage = state.results.find((r) => r.subrequestsFailed > 0)
      return {
        hypothesis: 'Limit is per connection lifetime',
        confirmed: true,
        explanation: `Errors started at message ${errorMessage?.messageNumber} with cumulative total ~${errorMessage?.cumulativeTotal}. ` +
          'This suggests the 1,000 limit applies to the entire connection.',
        subrequestBehavior: 'PER_CONNECTION_LIMIT',
      }
    } else {
      return {
        hypothesis: 'Inconclusive',
        confirmed: false,
        explanation: `Total succeeded: ${totalSucceeded}, attempted: ${totalAttempted}, had errors: ${hadErrors}. ` +
          'Results do not clearly indicate either behavior.',
        subrequestBehavior: 'UNKNOWN',
      }
    }
  }

  /**
   * HTTP test endpoint for comparison with WebSocket
   */
  private async handleHttpTest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const count = parseInt(url.searchParams.get('count') || '200', 10)

    const result = await this.makeSubrequests(count)

    return Response.json({
      type: 'http_test',
      ...result,
      note: 'HTTP requests have their own 1,000 subrequest limit per request',
    })
  }

  /**
   * Test DO-to-DO RPC subrequest counting
   *
   * Question: Does calling another DO count as 1 subrequest regardless
   * of how many subrequests that DO makes internally?
   */
  private async handleRpcTest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const callCount = parseInt(url.searchParams.get('calls') || '5', 10)
    const subrequestsPerCall = parseInt(url.searchParams.get('perCall') || '100', 10)

    const results: Array<{
      callNumber: number
      targetDOSubrequests: number
      success: boolean
      error?: string
    }> = []

    // Get secondary DO namespace (same class, different instance)
    const doNamespace = this.env.SUBREQUEST_TEST

    for (let i = 0; i < callCount; i++) {
      const doId = doNamespace.idFromName(`secondary-${i}`)
      const stub = doNamespace.get(doId)

      try {
        const response = await stub.fetch(
          new Request(`https://internal/make-subrequests?count=${subrequestsPerCall}`)
        )
        const data = await response.json() as { succeeded: number }

        results.push({
          callNumber: i + 1,
          targetDOSubrequests: data.succeeded,
          success: true,
        })
      } catch (error) {
        results.push({
          callNumber: i + 1,
          targetDOSubrequests: 0,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const totalDOCalls = results.length
    const totalInternalSubrequests = results.reduce((sum, r) => sum + r.targetDOSubrequests, 0)

    return Response.json({
      type: 'rpc_test',
      totalDOCalls,
      totalInternalSubrequests,
      results,
      analysis: {
        question: 'Does DO-to-DO RPC count as 1 subrequest regardless of internal work?',
        answer: results.every((r) => r.success)
          ? `Made ${totalDOCalls} DO calls that internally made ${totalInternalSubrequests} subrequests. ` +
            'All succeeded, suggesting each DO call counts as 1 subrequest from caller perspective.'
          : 'Test had failures - need to investigate error messages.',
      },
    })
  }
}

/**
 * Test Worker - Entry point for subrequest limit testing
 */
export default {
  async fetch(request: Request, env: SubrequestTestEnv): Promise<Response> {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'ws-subrequest-test' })
    }

    // Documentation
    if (url.pathname === '/' || url.pathname === '/docs') {
      return Response.json({
        name: 'WebSocket Subrequest Limit Test',
        hypothesis: 'The 1,000 subrequest limit resets after each WebSocket message',
        endpoints: {
          '/ws': 'WebSocket endpoint for main test',
          '/http-test?count=N': 'HTTP comparison test',
          '/rpc-test?calls=N&perCall=M': 'DO-to-DO RPC test',
          '/health': 'Health check',
        },
        usage: {
          step1: 'Connect to /ws via WebSocket',
          step2: 'Send { "action": "test", "subrequestCount": 200 }',
          step3: 'Repeat 10+ times',
          step4: 'Send { "action": "summary" } for analysis',
        },
        issue: 'dotdo-wlh7b',
      })
    }

    // Route to Durable Object
    const doId = env.SUBREQUEST_TEST.idFromName('primary')
    const stub = env.SUBREQUEST_TEST.get(doId)
    return stub.fetch(request)
  },
}
