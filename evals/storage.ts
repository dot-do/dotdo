/**
 * Evalite Custom Storage Adapter
 *
 * Sends eval results to the /e events pipeline, converting eval traces to 5W+H events.
 *
 * Reference: https://v1.evalite.dev/api/storage#implementing-custom-storage
 */

// ============================================================================
// Types
// ============================================================================

export interface EvaliteStorageOptions {
  endpoint: string
  fetch?: typeof fetch
  ns?: string
  actor?: string
  authorization?: string
  defaultModel?: string
  batchSize?: number
  flushInterval?: number
  retryAttempts?: number
  queueOffline?: boolean
}

export interface ConvertOptions {
  ns: string
  actor: string
  model?: string
  scores?: Array<{ id: string; evalId: string; name: string; score: number; reason?: string }>
}

// Storage interface types
interface CreateOpts<T> {
  data: T
}

interface UpdateOpts<T> {
  id: string
  data: T
}

interface GetManyOpts {
  where?: Record<string, unknown>
  limit?: number
  offset?: number
  orderBy?: string
}

// Entity types
interface Run {
  id: string
  createdAt: Date
  status: 'running' | 'completed' | 'failed'
}

interface RunInput {
  status?: 'running' | 'completed' | 'failed'
}

interface Suite {
  id: string
  runId: string
  name: string
  status: 'running' | 'completed' | 'failed'
  duration?: number
}

interface SuiteInput {
  runId: string
  name: string
  status?: 'running' | 'completed' | 'failed'
  duration?: number
}

interface Eval {
  id: string
  suiteId: string
  input: unknown
  output: unknown
  expected?: unknown
  duration: number
  status: 'passed' | 'failed' | 'pending'
}

interface EvalInput {
  suiteId: string
  input: unknown
  output: unknown
  expected?: unknown
  duration: number
  status?: 'passed' | 'failed' | 'pending'
}

interface Score {
  id: string
  evalId: string
  name: string
  score: number
  reason?: string
}

interface ScoreInput {
  evalId: string
  name: string
  score: number
  reason?: string
}

interface Trace {
  id: string
  evalId: string
  model: string
  input: unknown
  output: unknown
  latency: number
  tokens?: { input: number; output: number }
}

interface TraceInput {
  evalId: string
  model: string
  input: unknown
  output: unknown
  latency: number
  tokens?: { input: number; output: number }
}

// 5W+H Event format
interface Event {
  actor: string
  source?: string
  destination?: string
  object: string
  type: string
  quantity?: number
  timestamp: string
  recorded: string
  ns: string
  location?: string
  readPoint?: string
  verb: string
  disposition?: string
  reason?: string
  method?: 'code' | 'generative' | 'agentic' | 'human'
  branch?: string
  model?: string
  tools?: string[]
  channel?: string
  cascade?: unknown
  transaction?: string
  context?: Record<string, unknown>
}

// Storage interface
interface Storage {
  runs: {
    create(opts: CreateOpts<RunInput>): Promise<Run>
    getMany(opts?: GetManyOpts): Promise<Run[]>
  }
  suites: {
    create(opts: CreateOpts<SuiteInput>): Promise<Suite>
    update(opts: UpdateOpts<Partial<SuiteInput>>): Promise<Suite>
    getMany(opts?: GetManyOpts): Promise<Suite[]>
  }
  evals: {
    create(opts: CreateOpts<EvalInput>): Promise<Eval>
    update(opts: UpdateOpts<Partial<EvalInput>>): Promise<Eval>
    getMany(opts?: GetManyOpts): Promise<Eval[]>
  }
  scores: {
    create(opts: CreateOpts<ScoreInput>): Promise<Score>
    getMany(opts?: GetManyOpts): Promise<Score[]>
  }
  traces: {
    create(opts: CreateOpts<TraceInput>): Promise<Trace>
    getMany(opts?: GetManyOpts): Promise<Trace[]>
  }
  close(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}

// ============================================================================
// Utility Functions
// ============================================================================

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

function validateEvalInput(data: EvalInput): void {
  if (!data.suiteId || data.suiteId.trim() === '') {
    throw new Error('Invalid eval data: suiteId is required')
  }
  if (typeof data.duration !== 'number' || data.duration < 0) {
    throw new Error('Invalid eval data: duration must be a non-negative number')
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// Event Conversion Functions
// ============================================================================

/**
 * Converts an eval result to a 5W+H Event format.
 */
export function convertEvalToEvent(evalResult: Eval, options: ConvertOptions): Event {
  const now = new Date().toISOString()

  const event: Event = {
    // WHO
    actor: options.actor,

    // WHAT
    object: evalResult.id,
    type: 'Eval',

    // WHEN
    timestamp: now,
    recorded: now,

    // WHERE
    ns: options.ns,

    // WHY
    verb: 'evaluated',
    disposition: evalResult.status,

    // Context
    context: {
      input: evalResult.input,
      output: evalResult.output,
      latency: evalResult.duration,
    },
  }

  // Add model if available
  if (options.model) {
    event.model = options.model
    event.method = 'generative'
  }

  // Add scores if available
  if (options.scores && options.scores.length > 0) {
    event.context = {
      ...event.context,
      scores: options.scores.map((s) => ({ name: s.name, score: s.score })),
    }
  }

  // Add expected if present
  if (evalResult.expected !== undefined) {
    event.context = {
      ...event.context,
      expected: evalResult.expected,
    }
  }

  return event
}

/**
 * Converts a trace to a 5W+H Event format.
 */
export function convertTraceToEvent(trace: Trace, options: ConvertOptions): Event {
  const now = new Date().toISOString()

  const event: Event = {
    // WHO
    actor: options.actor,

    // WHAT
    object: trace.id,
    type: 'Trace',

    // WHEN
    timestamp: now,
    recorded: now,

    // WHERE
    ns: options.ns,

    // WHY
    verb: 'traced',

    // HOW
    model: trace.model,
    method: 'generative',

    // Link to parent eval
    transaction: trace.evalId,

    // Context
    context: {
      input: trace.input,
      output: trace.output,
      latency: trace.latency,
    },
  }

  // Add token counts if available
  if (trace.tokens) {
    event.context = {
      ...event.context,
      tokens: trace.tokens,
    }
  }

  return event
}

// ============================================================================
// Storage Implementation
// ============================================================================

/**
 * Creates an evalite storage adapter that sends events to the /e endpoint.
 */
export function createEvaliteStorage(options: EvaliteStorageOptions): Storage {
  const {
    endpoint,
    fetch: customFetch = globalThis.fetch,
    ns = 'https://evals.dotdo.ai',
    actor = 'evalite-runner',
    authorization,
    defaultModel,
    batchSize = 1,
    flushInterval = 0,
    retryAttempts = 3,
    queueOffline = false,
  } = options

  // In-memory storage for entities
  const runs = new Map<string, Run>()
  const suites = new Map<string, Suite>()
  const evals = new Map<string, Eval>()
  const scores = new Map<string, Score>()
  const traces = new Map<string, Trace>()

  // Event queue for batching
  const eventQueue: Event[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  // Send event to endpoint with retry logic
  async function sendEvent(event: Event | Event[]): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (authorization) {
      headers['Authorization'] = authorization
    }

    const body = JSON.stringify(event)

    let lastError: Error | null = null
    for (let attempt = 0; attempt < retryAttempts; attempt++) {
      try {
        const response = await customFetch(endpoint, {
          method: 'POST',
          headers,
          body,
        })

        if (response.ok) {
          return
        }

        // Non-ok response - log but don't throw
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`)
      } catch (error) {
        lastError = error as Error
        // If offline queuing is enabled, we can try again later
        if (queueOffline && attempt < retryAttempts - 1) {
          // Exponential backoff
          await sleep(Math.pow(2, attempt) * 100)
          continue
        }
      }

      // Exponential backoff before retry
      if (attempt < retryAttempts - 1) {
        await sleep(Math.pow(2, attempt) * 100)
      }
    }

    // After all retries, just log the error - don't throw
    if (lastError) {
      console.error('Failed to send event:', lastError.message)
    }
  }

  // Queue event for batching
  function queueEvent(event: Event): void {
    eventQueue.push(event)

    // If batch is full, flush immediately
    if (eventQueue.length >= batchSize) {
      flushQueue()
    } else if (flushInterval > 0 && !flushTimer) {
      // Schedule flush after interval
      flushTimer = setTimeout(() => {
        flushQueue()
      }, flushInterval)
    } else if (flushInterval === 0) {
      // Immediate flush when flushInterval is 0
      flushQueue()
    }
  }

  // Flush the event queue
  async function flushQueue(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }

    if (eventQueue.length === 0) {
      return
    }

    const events = eventQueue.splice(0, eventQueue.length)

    if (events.length === 1) {
      await sendEvent(events[0])
    } else if (events.length > 1) {
      // Send as array or wrapped in events object
      await sendEvent(events)
    }
  }

  // Create and send event
  async function createAndSendEvent(
    entity: Eval | Trace | Score,
    type: 'eval' | 'trace' | 'score',
  ): Promise<void> {
    let event: Event

    if (type === 'eval') {
      event = convertEvalToEvent(entity as Eval, {
        ns,
        actor,
        model: defaultModel,
      })
    } else if (type === 'trace') {
      event = convertTraceToEvent(entity as Trace, {
        ns,
        actor,
      })
    } else {
      // Score event
      const score = entity as Score
      event = {
        actor,
        object: score.id,
        type: 'Score',
        timestamp: new Date().toISOString(),
        recorded: new Date().toISOString(),
        ns,
        verb: 'scored',
        context: {
          evalId: score.evalId,
          name: score.name,
          score: score.score,
          reason: score.reason,
        },
      }
    }

    queueEvent(event)
  }

  const storage: Storage = {
    runs: {
      async create(opts: CreateOpts<RunInput>): Promise<Run> {
        const run: Run = {
          id: generateId(),
          createdAt: new Date(),
          status: opts.data.status || 'running',
        }
        runs.set(run.id, run)
        return run
      },

      async getMany(opts?: GetManyOpts): Promise<Run[]> {
        let results = Array.from(runs.values())

        // Apply filtering
        if (opts?.where) {
          results = results.filter((run) => {
            for (const [key, value] of Object.entries(opts.where!)) {
              if ((run as any)[key] !== value) {
                return false
              }
            }
            return true
          })
        }

        // Apply limit
        if (opts?.limit) {
          results = results.slice(0, opts.limit)
        }

        return results
      },
    },

    suites: {
      async create(opts: CreateOpts<SuiteInput>): Promise<Suite> {
        const suite: Suite = {
          id: generateId(),
          runId: opts.data.runId,
          name: opts.data.name,
          status: opts.data.status || 'running',
          duration: opts.data.duration,
        }
        suites.set(suite.id, suite)
        return suite
      },

      async update(opts: UpdateOpts<Partial<SuiteInput>>): Promise<Suite> {
        let suite = suites.get(opts.id)
        if (!suite) {
          // Create a new suite if it doesn't exist (for update-or-create semantics)
          suite = {
            id: opts.id,
            runId: opts.data.runId || '',
            name: opts.data.name || '',
            status: opts.data.status || 'running',
            duration: opts.data.duration,
          }
        } else {
          // Update existing suite
          suite = {
            ...suite,
            ...opts.data,
          } as Suite
        }
        suites.set(opts.id, suite)
        return suite
      },

      async getMany(opts?: GetManyOpts): Promise<Suite[]> {
        let results = Array.from(suites.values())

        if (opts?.where) {
          results = results.filter((suite) => {
            for (const [key, value] of Object.entries(opts.where!)) {
              if ((suite as any)[key] !== value) {
                return false
              }
            }
            return true
          })
        }

        if (opts?.limit) {
          results = results.slice(0, opts.limit)
        }

        return results
      },
    },

    evals: {
      async create(opts: CreateOpts<EvalInput>): Promise<Eval> {
        // Validate input
        validateEvalInput(opts.data)

        const evalResult: Eval = {
          id: generateId(),
          suiteId: opts.data.suiteId,
          input: opts.data.input,
          output: opts.data.output,
          expected: opts.data.expected,
          duration: opts.data.duration,
          status: opts.data.status || 'pending',
        }
        evals.set(evalResult.id, evalResult)

        // Send event to endpoint
        await createAndSendEvent(evalResult, 'eval')

        return evalResult
      },

      async update(opts: UpdateOpts<Partial<EvalInput>>): Promise<Eval> {
        let evalResult = evals.get(opts.id)
        if (!evalResult) {
          evalResult = {
            id: opts.id,
            suiteId: opts.data.suiteId || '',
            input: opts.data.input,
            output: opts.data.output,
            expected: opts.data.expected,
            duration: opts.data.duration || 0,
            status: opts.data.status || 'pending',
          }
        } else {
          evalResult = {
            ...evalResult,
            ...opts.data,
          } as Eval
        }
        evals.set(opts.id, evalResult)
        return evalResult
      },

      async getMany(opts?: GetManyOpts): Promise<Eval[]> {
        let results = Array.from(evals.values())

        if (opts?.where) {
          results = results.filter((evalResult) => {
            for (const [key, value] of Object.entries(opts.where!)) {
              if ((evalResult as any)[key] !== value) {
                return false
              }
            }
            return true
          })
        }

        if (opts?.limit) {
          results = results.slice(0, opts.limit)
        }

        return results
      },
    },

    scores: {
      async create(opts: CreateOpts<ScoreInput>): Promise<Score> {
        const score: Score = {
          id: generateId(),
          evalId: opts.data.evalId,
          name: opts.data.name,
          score: opts.data.score,
          reason: opts.data.reason,
        }
        scores.set(score.id, score)

        // Send event to endpoint
        await createAndSendEvent(score, 'score')

        return score
      },

      async getMany(opts?: GetManyOpts): Promise<Score[]> {
        let results = Array.from(scores.values())

        if (opts?.where) {
          results = results.filter((score) => {
            for (const [key, value] of Object.entries(opts.where!)) {
              if ((score as any)[key] !== value) {
                return false
              }
            }
            return true
          })
        }

        if (opts?.limit) {
          results = results.slice(0, opts.limit)
        }

        return results
      },
    },

    traces: {
      async create(opts: CreateOpts<TraceInput>): Promise<Trace> {
        const trace: Trace = {
          id: generateId(),
          evalId: opts.data.evalId,
          model: opts.data.model,
          input: opts.data.input,
          output: opts.data.output,
          latency: opts.data.latency,
          tokens: opts.data.tokens,
        }
        traces.set(trace.id, trace)

        // Send event to endpoint
        await createAndSendEvent(trace, 'trace')

        return trace
      },

      async getMany(opts?: GetManyOpts): Promise<Trace[]> {
        let results = Array.from(traces.values())

        if (opts?.where) {
          results = results.filter((trace) => {
            for (const [key, value] of Object.entries(opts.where!)) {
              if ((trace as any)[key] !== value) {
                return false
              }
            }
            return true
          })
        }

        if (opts?.limit) {
          results = results.slice(0, opts.limit)
        }

        return results
      },
    },

    async close(): Promise<void> {
      await flushQueue()
    },

    async [Symbol.asyncDispose](): Promise<void> {
      await this.close()
    },
  }

  return storage
}

/**
 * EvaliteStorage class implementing the Storage interface.
 * This is exported as a type alias for the implementation.
 */
export type EvaliteStorage = ReturnType<typeof createEvaliteStorage>
