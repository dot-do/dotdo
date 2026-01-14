/**
 * Test fixtures for Workers tail event transformer
 *
 * Cloudflare Workers tail events have a specific structure that captures
 * request execution details, outcomes, logs, and exceptions.
 */

/**
 * TailEvent represents a Cloudflare Workers tail log event.
 * This is the raw structure from the Workers runtime.
 */
export interface TailEvent {
  scriptName: string
  scriptVersion?: string
  outcome: 'ok' | 'exception' | 'exceededCpu' | 'exceededMemory' | 'canceled' | 'unknown'
  exceptions?: Array<{ name: string; message: string; timestamp: number }>
  logs?: Array<{ level: string; message: unknown[]; timestamp: number }>
  eventTimestamp: number
  event?: {
    type?: string
    request?: {
      url: string
      method: string
      headers?: Record<string, string>
      cf?: {
        colo?: string
        country?: string
        city?: string
        region?: string
        timezone?: string
        asn?: number
        asOrganization?: string
        httpProtocol?: string
      }
    }
    response?: { status?: number }
    cron?: string
    scheduledTime?: number
    queue?: {
      queueName: string
      batchSize: number
    }
  }
  diagnosticsChannelEvents?: unknown[]
}

// ============================================================================
// Basic HTTP Request Event
// ============================================================================

export const httpRequestOk: TailEvent = {
  scriptName: 'my-worker',
  scriptVersion: '1.0.0',
  outcome: 'ok',
  eventTimestamp: 1704067200000, // 2024-01-01T00:00:00.000Z
  event: {
    type: 'fetch',
    request: {
      url: 'https://api.example.com/users/123',
      method: 'GET',
      headers: {
        'user-agent': 'Mozilla/5.0',
        'content-type': 'application/json',
      },
      cf: {
        colo: 'SJC',
        country: 'US',
        city: 'San Jose',
        region: 'California',
        timezone: 'America/Los_Angeles',
        asn: 13335,
        asOrganization: 'Cloudflare Inc',
        httpProtocol: 'HTTP/2',
      },
    },
    response: { status: 200 },
  },
}

// ============================================================================
// Event with Exception
// ============================================================================

export const httpRequestException: TailEvent = {
  scriptName: 'failing-worker',
  outcome: 'exception',
  eventTimestamp: 1704067260000, // 2024-01-01T00:01:00.000Z
  exceptions: [
    {
      name: 'TypeError',
      message: 'Cannot read property "id" of undefined',
      timestamp: 1704067260123,
    },
  ],
  logs: [
    {
      level: 'log',
      message: ['Processing request...'],
      timestamp: 1704067260100,
    },
    {
      level: 'error',
      message: ['Failed to process request'],
      timestamp: 1704067260120,
    },
  ],
  event: {
    type: 'fetch',
    request: {
      url: 'https://api.example.com/broken',
      method: 'POST',
      cf: {
        colo: 'IAD',
        country: 'US',
      },
    },
    response: { status: 500 },
  },
}

// ============================================================================
// CPU Limit Exceeded
// ============================================================================

export const cpuExceeded: TailEvent = {
  scriptName: 'heavy-worker',
  outcome: 'exceededCpu',
  eventTimestamp: 1704067320000, // 2024-01-01T00:02:00.000Z
  logs: [
    {
      level: 'log',
      message: ['Starting heavy computation...'],
      timestamp: 1704067320000,
    },
  ],
  event: {
    type: 'fetch',
    request: {
      url: 'https://api.example.com/compute',
      method: 'POST',
      cf: {
        colo: 'LHR',
        country: 'GB',
        city: 'London',
      },
    },
  },
}

// ============================================================================
// Memory Limit Exceeded
// ============================================================================

export const memoryExceeded: TailEvent = {
  scriptName: 'memory-hog',
  outcome: 'exceededMemory',
  eventTimestamp: 1704067380000,
  event: {
    type: 'fetch',
    request: {
      url: 'https://api.example.com/upload',
      method: 'PUT',
      cf: {
        colo: 'FRA',
        country: 'DE',
      },
    },
  },
}

// ============================================================================
// Canceled Request
// ============================================================================

export const canceledRequest: TailEvent = {
  scriptName: 'slow-worker',
  outcome: 'canceled',
  eventTimestamp: 1704067440000,
  event: {
    type: 'fetch',
    request: {
      url: 'https://api.example.com/slow',
      method: 'GET',
      cf: {
        colo: 'NRT',
        country: 'JP',
        city: 'Tokyo',
      },
    },
  },
}

// ============================================================================
// Unknown Outcome
// ============================================================================

export const unknownOutcome: TailEvent = {
  scriptName: 'mystery-worker',
  outcome: 'unknown',
  eventTimestamp: 1704067500000,
  event: {
    type: 'fetch',
    request: {
      url: 'https://api.example.com/mystery',
      method: 'GET',
    },
  },
}

// ============================================================================
// Scheduled (Cron) Event
// ============================================================================

export const cronEvent: TailEvent = {
  scriptName: 'cron-worker',
  outcome: 'ok',
  eventTimestamp: 1704067200000,
  event: {
    type: 'scheduled',
    cron: '0 * * * *',
    scheduledTime: 1704067200000,
  },
}

// ============================================================================
// Queue Event
// ============================================================================

export const queueEvent: TailEvent = {
  scriptName: 'queue-worker',
  outcome: 'ok',
  eventTimestamp: 1704067200000,
  logs: [
    {
      level: 'log',
      message: ['Processing batch of messages'],
      timestamp: 1704067200000,
    },
  ],
  event: {
    type: 'queue',
    queue: {
      queueName: 'my-queue',
      batchSize: 10,
    },
  },
}

// ============================================================================
// Alarm Event (Durable Objects)
// ============================================================================

export const alarmEvent: TailEvent = {
  scriptName: 'do-worker',
  outcome: 'ok',
  eventTimestamp: 1704067200000,
  event: {
    type: 'alarm',
  },
}

// ============================================================================
// Minimal Event (minimal required fields)
// ============================================================================

export const minimalEvent: TailEvent = {
  scriptName: 'minimal-worker',
  outcome: 'ok',
  eventTimestamp: 1704067200000,
}

// ============================================================================
// Event with Full Geo Data
// ============================================================================

export const fullGeoEvent: TailEvent = {
  scriptName: 'geo-worker',
  outcome: 'ok',
  eventTimestamp: 1704067200000,
  event: {
    type: 'fetch',
    request: {
      url: 'https://api.example.com/geo',
      method: 'GET',
      cf: {
        colo: 'SYD',
        country: 'AU',
        city: 'Sydney',
        region: 'New South Wales',
        timezone: 'Australia/Sydney',
        asn: 15169,
        asOrganization: 'Google LLC',
        httpProtocol: 'HTTP/3',
      },
    },
    response: { status: 200 },
  },
}

// ============================================================================
// Event with Multiple Logs
// ============================================================================

export const multiLogEvent: TailEvent = {
  scriptName: 'verbose-worker',
  outcome: 'ok',
  eventTimestamp: 1704067200000,
  logs: [
    { level: 'debug', message: ['Debug info', { key: 'value' }], timestamp: 1704067200000 },
    { level: 'log', message: ['Processing...'], timestamp: 1704067200010 },
    { level: 'info', message: ['Request handled'], timestamp: 1704067200020 },
    { level: 'warn', message: ['Deprecation warning'], timestamp: 1704067200030 },
  ],
  event: {
    type: 'fetch',
    request: {
      url: 'https://api.example.com/verbose',
      method: 'GET',
      cf: { colo: 'DFW' },
    },
    response: { status: 200 },
  },
}

// ============================================================================
// Event with Multiple Exceptions
// ============================================================================

export const multiExceptionEvent: TailEvent = {
  scriptName: 'multi-error-worker',
  outcome: 'exception',
  eventTimestamp: 1704067200000,
  exceptions: [
    { name: 'Error', message: 'First error', timestamp: 1704067200100 },
    { name: 'TypeError', message: 'Second error', timestamp: 1704067200200 },
    { name: 'RangeError', message: 'Third error', timestamp: 1704067200300 },
  ],
  event: {
    type: 'fetch',
    request: {
      url: 'https://api.example.com/multi-error',
      method: 'GET',
    },
    response: { status: 500 },
  },
}
