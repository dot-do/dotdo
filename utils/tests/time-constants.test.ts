/**
 * Tests for utils/time-constants.ts
 *
 * Comprehensive test coverage for time constants:
 * 1. Time unit multipliers (MS_PER_*, SECONDS_PER_*)
 * 2. Timeout defaults
 * 3. Cache and buffer defaults
 * 4. Rate limiting defaults
 * 5. RPC and transport defaults
 * 6. WebSocket and connection defaults
 * 7. Storage and queue defaults
 * 8. Validation and size limit defaults
 * 9. API key defaults
 */

import { describe, it, expect } from 'vitest'
import {
  // Time unit multipliers
  MS_PER_SECOND,
  MS_PER_MINUTE,
  MS_PER_HOUR,
  MS_PER_DAY,
  SECONDS_PER_MINUTE,
  SECONDS_PER_HOUR,
  SECONDS_PER_DAY,

  // Timeout defaults
  DEFAULT_TEST_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RETRY_BASE_DELAY_MS,
  DEFAULT_RETRY_MAX_DELAY_MS,
  DEFAULT_MAX_RETRY_ATTEMPTS,

  // Cache & buffer defaults
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_BUFFER_FLUSH_INTERVAL_MS,
  DEFAULT_CLEANUP_INTERVAL_MS,

  // Rate limiting defaults
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  DEFAULT_FREE_TIER_REQUESTS,
  DEFAULT_PRO_TIER_REQUESTS,
  DEFAULT_ENTERPRISE_TIER_REQUESTS,

  // RPC & transport defaults
  DEFAULT_RPC_TIMEOUT_MS,
  DEFAULT_RECONNECT_DELAY_MS,
  DEFAULT_MAX_RECONNECT_DELAY_MS,
  DEFAULT_MAX_RECONNECT_ATTEMPTS,

  // WebSocket & connection defaults
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_CONNECTION_TIMEOUT_MS,

  // Storage & queue defaults
  DEFAULT_MAX_STORE_ENTRIES,
  DEFAULT_MAX_ERROR_AGE_MS,
  DEFAULT_MAX_BACKOFF_MS,
  DEFAULT_PROCESS_INTERVAL_MS,
  DEFAULT_COMPLETED_ITEM_MAX_AGE_MS,

  // CORS defaults
  DEFAULT_CORS_MAX_AGE_SECONDS,

  // Session & auth defaults
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  DEFAULT_ORG_AI_TIMEOUT_MS,

  // Eval defaults
  DEFAULT_EVAL_TIMEOUT_MS,

  // Validation & size limit defaults
  DEFAULT_MAX_STRING_LENGTH,
  DEFAULT_MAX_OBJECT_DEPTH,
  DEFAULT_MAX_OBJECT_KEYS,
  DEFAULT_MAX_ARRAY_LENGTH,
  MAX_ID_LENGTH,
  MAX_TYPE_NAME_LENGTH,
  DEFAULT_PAGINATION_LIMIT,
  MAX_PAGINATION_LIMIT,
  DEFAULT_MAX_PIPELINE_DEPTH,

  // API key defaults
  API_KEY_PREFIX_LENGTH,
  API_KEY_SECRET_MIN_LENGTH,
  API_KEY_RANDOM_BYTES_LENGTH,
} from '../time-constants'

describe('Time Unit Multipliers', () => {
  describe('Milliseconds per unit', () => {
    it('MS_PER_SECOND should be 1000', () => {
      expect(MS_PER_SECOND).toBe(1000)
    })

    it('MS_PER_MINUTE should be 60 * 1000 = 60000', () => {
      expect(MS_PER_MINUTE).toBe(60000)
      expect(MS_PER_MINUTE).toBe(60 * MS_PER_SECOND)
    })

    it('MS_PER_HOUR should be 60 * 60 * 1000 = 3600000', () => {
      expect(MS_PER_HOUR).toBe(3600000)
      expect(MS_PER_HOUR).toBe(60 * MS_PER_MINUTE)
    })

    it('MS_PER_DAY should be 24 * 60 * 60 * 1000 = 86400000', () => {
      expect(MS_PER_DAY).toBe(86400000)
      expect(MS_PER_DAY).toBe(24 * MS_PER_HOUR)
    })
  })

  describe('Seconds per unit', () => {
    it('SECONDS_PER_MINUTE should be 60', () => {
      expect(SECONDS_PER_MINUTE).toBe(60)
    })

    it('SECONDS_PER_HOUR should be 60 * 60 = 3600', () => {
      expect(SECONDS_PER_HOUR).toBe(3600)
      expect(SECONDS_PER_HOUR).toBe(60 * SECONDS_PER_MINUTE)
    })

    it('SECONDS_PER_DAY should be 24 * 60 * 60 = 86400', () => {
      expect(SECONDS_PER_DAY).toBe(86400)
      expect(SECONDS_PER_DAY).toBe(24 * SECONDS_PER_HOUR)
    })
  })

  describe('Consistency between milliseconds and seconds', () => {
    it('MS_PER_MINUTE should equal SECONDS_PER_MINUTE * MS_PER_SECOND', () => {
      expect(MS_PER_MINUTE).toBe(SECONDS_PER_MINUTE * MS_PER_SECOND)
    })

    it('MS_PER_HOUR should equal SECONDS_PER_HOUR * MS_PER_SECOND', () => {
      expect(MS_PER_HOUR).toBe(SECONDS_PER_HOUR * MS_PER_SECOND)
    })

    it('MS_PER_DAY should equal SECONDS_PER_DAY * MS_PER_SECOND', () => {
      expect(MS_PER_DAY).toBe(SECONDS_PER_DAY * MS_PER_SECOND)
    })
  })
})

describe('Timeout Defaults', () => {
  it('DEFAULT_TEST_TIMEOUT_MS should be 5 seconds (5000ms)', () => {
    expect(DEFAULT_TEST_TIMEOUT_MS).toBe(5000)
    expect(DEFAULT_TEST_TIMEOUT_MS).toBe(5 * MS_PER_SECOND)
  })

  it('DEFAULT_POLL_INTERVAL_MS should be 50ms', () => {
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(50)
  })

  it('DEFAULT_RETRY_BASE_DELAY_MS should be 100ms', () => {
    expect(DEFAULT_RETRY_BASE_DELAY_MS).toBe(100)
  })

  it('DEFAULT_RETRY_MAX_DELAY_MS should be 5 seconds (5000ms)', () => {
    expect(DEFAULT_RETRY_MAX_DELAY_MS).toBe(5000)
    expect(DEFAULT_RETRY_MAX_DELAY_MS).toBe(5 * MS_PER_SECOND)
  })

  it('DEFAULT_MAX_RETRY_ATTEMPTS should be 3', () => {
    expect(DEFAULT_MAX_RETRY_ATTEMPTS).toBe(3)
  })

  it('retry max delay should be greater than base delay', () => {
    expect(DEFAULT_RETRY_MAX_DELAY_MS).toBeGreaterThan(DEFAULT_RETRY_BASE_DELAY_MS)
  })
})

describe('Cache & Buffer Defaults', () => {
  it('DEFAULT_CACHE_TTL_MS should be 1 minute (60000ms)', () => {
    expect(DEFAULT_CACHE_TTL_MS).toBe(60000)
    expect(DEFAULT_CACHE_TTL_MS).toBe(MS_PER_MINUTE)
  })

  it('DEFAULT_BUFFER_FLUSH_INTERVAL_MS should be 5 seconds (5000ms)', () => {
    expect(DEFAULT_BUFFER_FLUSH_INTERVAL_MS).toBe(5000)
    expect(DEFAULT_BUFFER_FLUSH_INTERVAL_MS).toBe(5 * MS_PER_SECOND)
  })

  it('DEFAULT_CLEANUP_INTERVAL_MS should be 5 minutes (300000ms)', () => {
    expect(DEFAULT_CLEANUP_INTERVAL_MS).toBe(300000)
    expect(DEFAULT_CLEANUP_INTERVAL_MS).toBe(5 * MS_PER_MINUTE)
  })

  it('cleanup interval should be greater than cache TTL', () => {
    expect(DEFAULT_CLEANUP_INTERVAL_MS).toBeGreaterThan(DEFAULT_CACHE_TTL_MS)
  })
})

describe('Rate Limiting Defaults', () => {
  it('DEFAULT_RATE_LIMIT_WINDOW_MS should be 1 minute (60000ms)', () => {
    expect(DEFAULT_RATE_LIMIT_WINDOW_MS).toBe(60000)
    expect(DEFAULT_RATE_LIMIT_WINDOW_MS).toBe(MS_PER_MINUTE)
  })

  it('DEFAULT_FREE_TIER_REQUESTS should be 100', () => {
    expect(DEFAULT_FREE_TIER_REQUESTS).toBe(100)
  })

  it('DEFAULT_PRO_TIER_REQUESTS should be 1000', () => {
    expect(DEFAULT_PRO_TIER_REQUESTS).toBe(1000)
  })

  it('DEFAULT_ENTERPRISE_TIER_REQUESTS should be 10000', () => {
    expect(DEFAULT_ENTERPRISE_TIER_REQUESTS).toBe(10000)
  })

  it('tier request limits should be in ascending order', () => {
    expect(DEFAULT_FREE_TIER_REQUESTS).toBeLessThan(DEFAULT_PRO_TIER_REQUESTS)
    expect(DEFAULT_PRO_TIER_REQUESTS).toBeLessThan(DEFAULT_ENTERPRISE_TIER_REQUESTS)
  })

  it('pro tier should be 10x free tier', () => {
    expect(DEFAULT_PRO_TIER_REQUESTS).toBe(10 * DEFAULT_FREE_TIER_REQUESTS)
  })

  it('enterprise tier should be 10x pro tier', () => {
    expect(DEFAULT_ENTERPRISE_TIER_REQUESTS).toBe(10 * DEFAULT_PRO_TIER_REQUESTS)
  })
})

describe('RPC & Transport Defaults', () => {
  it('DEFAULT_RPC_TIMEOUT_MS should be 30 seconds (30000ms)', () => {
    expect(DEFAULT_RPC_TIMEOUT_MS).toBe(30000)
    expect(DEFAULT_RPC_TIMEOUT_MS).toBe(30 * MS_PER_SECOND)
  })

  it('DEFAULT_RECONNECT_DELAY_MS should be 1 second (1000ms)', () => {
    expect(DEFAULT_RECONNECT_DELAY_MS).toBe(1000)
    expect(DEFAULT_RECONNECT_DELAY_MS).toBe(MS_PER_SECOND)
  })

  it('DEFAULT_MAX_RECONNECT_DELAY_MS should be 30 seconds (30000ms)', () => {
    expect(DEFAULT_MAX_RECONNECT_DELAY_MS).toBe(30000)
    expect(DEFAULT_MAX_RECONNECT_DELAY_MS).toBe(30 * MS_PER_SECOND)
  })

  it('DEFAULT_MAX_RECONNECT_ATTEMPTS should be 5', () => {
    expect(DEFAULT_MAX_RECONNECT_ATTEMPTS).toBe(5)
  })

  it('max reconnect delay should be greater than initial delay', () => {
    expect(DEFAULT_MAX_RECONNECT_DELAY_MS).toBeGreaterThan(DEFAULT_RECONNECT_DELAY_MS)
  })

  it('max reconnect delay should equal RPC timeout', () => {
    expect(DEFAULT_MAX_RECONNECT_DELAY_MS).toBe(DEFAULT_RPC_TIMEOUT_MS)
  })
})

describe('WebSocket & Connection Defaults', () => {
  it('DEFAULT_HEARTBEAT_INTERVAL_MS should be 30 seconds (30000ms)', () => {
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(30000)
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(30 * MS_PER_SECOND)
  })

  it('DEFAULT_CONNECTION_TIMEOUT_MS should be 1 minute (60000ms)', () => {
    expect(DEFAULT_CONNECTION_TIMEOUT_MS).toBe(60000)
    expect(DEFAULT_CONNECTION_TIMEOUT_MS).toBe(MS_PER_MINUTE)
  })

  it('connection timeout should be greater than heartbeat interval', () => {
    expect(DEFAULT_CONNECTION_TIMEOUT_MS).toBeGreaterThan(DEFAULT_HEARTBEAT_INTERVAL_MS)
  })
})

describe('Storage & Queue Defaults', () => {
  it('DEFAULT_MAX_STORE_ENTRIES should be 10000', () => {
    expect(DEFAULT_MAX_STORE_ENTRIES).toBe(10000)
  })

  it('DEFAULT_MAX_ERROR_AGE_MS should be 1 day (86400000ms)', () => {
    expect(DEFAULT_MAX_ERROR_AGE_MS).toBe(86400000)
    expect(DEFAULT_MAX_ERROR_AGE_MS).toBe(MS_PER_DAY)
  })

  it('DEFAULT_MAX_BACKOFF_MS should be 1 minute (60000ms)', () => {
    expect(DEFAULT_MAX_BACKOFF_MS).toBe(60000)
    expect(DEFAULT_MAX_BACKOFF_MS).toBe(MS_PER_MINUTE)
  })

  it('DEFAULT_PROCESS_INTERVAL_MS should be 1 second (1000ms)', () => {
    expect(DEFAULT_PROCESS_INTERVAL_MS).toBe(1000)
    expect(DEFAULT_PROCESS_INTERVAL_MS).toBe(MS_PER_SECOND)
  })

  it('DEFAULT_COMPLETED_ITEM_MAX_AGE_MS should be 1 hour (3600000ms)', () => {
    expect(DEFAULT_COMPLETED_ITEM_MAX_AGE_MS).toBe(3600000)
    expect(DEFAULT_COMPLETED_ITEM_MAX_AGE_MS).toBe(MS_PER_HOUR)
  })

  it('error age should be greater than completed item age', () => {
    expect(DEFAULT_MAX_ERROR_AGE_MS).toBeGreaterThan(DEFAULT_COMPLETED_ITEM_MAX_AGE_MS)
  })
})

describe('CORS Defaults', () => {
  it('DEFAULT_CORS_MAX_AGE_SECONDS should be 1 day (86400 seconds)', () => {
    expect(DEFAULT_CORS_MAX_AGE_SECONDS).toBe(86400)
    expect(DEFAULT_CORS_MAX_AGE_SECONDS).toBe(SECONDS_PER_DAY)
  })
})

describe('Session & Auth Defaults', () => {
  it('DEFAULT_SESSION_MAX_AGE_SECONDS should be 1 hour (3600 seconds)', () => {
    expect(DEFAULT_SESSION_MAX_AGE_SECONDS).toBe(3600)
    expect(DEFAULT_SESSION_MAX_AGE_SECONDS).toBe(SECONDS_PER_HOUR)
  })

  it('DEFAULT_ORG_AI_TIMEOUT_MS should be 5 seconds (5000ms)', () => {
    expect(DEFAULT_ORG_AI_TIMEOUT_MS).toBe(5000)
    expect(DEFAULT_ORG_AI_TIMEOUT_MS).toBe(5 * MS_PER_SECOND)
  })
})

describe('Eval Defaults', () => {
  it('DEFAULT_EVAL_TIMEOUT_MS should be 5 seconds (5000ms)', () => {
    expect(DEFAULT_EVAL_TIMEOUT_MS).toBe(5000)
    expect(DEFAULT_EVAL_TIMEOUT_MS).toBe(5 * MS_PER_SECOND)
  })
})

describe('Validation & Size Limit Defaults', () => {
  describe('String and object limits', () => {
    it('DEFAULT_MAX_STRING_LENGTH should be 10000', () => {
      expect(DEFAULT_MAX_STRING_LENGTH).toBe(10000)
    })

    it('DEFAULT_MAX_OBJECT_DEPTH should be 10', () => {
      expect(DEFAULT_MAX_OBJECT_DEPTH).toBe(10)
    })

    it('DEFAULT_MAX_OBJECT_KEYS should be 100', () => {
      expect(DEFAULT_MAX_OBJECT_KEYS).toBe(100)
    })

    it('DEFAULT_MAX_ARRAY_LENGTH should be 1000', () => {
      expect(DEFAULT_MAX_ARRAY_LENGTH).toBe(1000)
    })
  })

  describe('ID and type limits', () => {
    it('MAX_ID_LENGTH should be 256', () => {
      expect(MAX_ID_LENGTH).toBe(256)
    })

    it('MAX_TYPE_NAME_LENGTH should be 100', () => {
      expect(MAX_TYPE_NAME_LENGTH).toBe(100)
    })

    it('ID length should be greater than type name length', () => {
      expect(MAX_ID_LENGTH).toBeGreaterThan(MAX_TYPE_NAME_LENGTH)
    })
  })

  describe('Pagination limits', () => {
    it('DEFAULT_PAGINATION_LIMIT should be 100', () => {
      expect(DEFAULT_PAGINATION_LIMIT).toBe(100)
    })

    it('MAX_PAGINATION_LIMIT should be 10000', () => {
      expect(MAX_PAGINATION_LIMIT).toBe(10000)
    })

    it('max pagination should be greater than default', () => {
      expect(MAX_PAGINATION_LIMIT).toBeGreaterThan(DEFAULT_PAGINATION_LIMIT)
    })

    it('max pagination should be 100x default', () => {
      expect(MAX_PAGINATION_LIMIT).toBe(100 * DEFAULT_PAGINATION_LIMIT)
    })
  })

  describe('Pipeline limits', () => {
    it('DEFAULT_MAX_PIPELINE_DEPTH should be 10', () => {
      expect(DEFAULT_MAX_PIPELINE_DEPTH).toBe(10)
    })

    it('pipeline depth should equal object depth', () => {
      expect(DEFAULT_MAX_PIPELINE_DEPTH).toBe(DEFAULT_MAX_OBJECT_DEPTH)
    })
  })
})

describe('API Key Defaults', () => {
  it('API_KEY_PREFIX_LENGTH should be 12', () => {
    expect(API_KEY_PREFIX_LENGTH).toBe(12)
  })

  it('API_KEY_SECRET_MIN_LENGTH should be 16', () => {
    expect(API_KEY_SECRET_MIN_LENGTH).toBe(16)
  })

  it('API_KEY_RANDOM_BYTES_LENGTH should be 32', () => {
    expect(API_KEY_RANDOM_BYTES_LENGTH).toBe(32)
  })

  it('random bytes should be double the minimum secret length', () => {
    expect(API_KEY_RANDOM_BYTES_LENGTH).toBe(2 * API_KEY_SECRET_MIN_LENGTH)
  })

  it('secret min length should be greater than prefix length', () => {
    expect(API_KEY_SECRET_MIN_LENGTH).toBeGreaterThan(API_KEY_PREFIX_LENGTH)
  })
})

describe('Value type checks', () => {
  it('all time constants should be numbers', () => {
    // Time unit multipliers
    expect(typeof MS_PER_SECOND).toBe('number')
    expect(typeof MS_PER_MINUTE).toBe('number')
    expect(typeof MS_PER_HOUR).toBe('number')
    expect(typeof MS_PER_DAY).toBe('number')
    expect(typeof SECONDS_PER_MINUTE).toBe('number')
    expect(typeof SECONDS_PER_HOUR).toBe('number')
    expect(typeof SECONDS_PER_DAY).toBe('number')

    // Timeout defaults
    expect(typeof DEFAULT_TEST_TIMEOUT_MS).toBe('number')
    expect(typeof DEFAULT_POLL_INTERVAL_MS).toBe('number')
    expect(typeof DEFAULT_RETRY_BASE_DELAY_MS).toBe('number')
    expect(typeof DEFAULT_RETRY_MAX_DELAY_MS).toBe('number')
    expect(typeof DEFAULT_MAX_RETRY_ATTEMPTS).toBe('number')

    // Cache & buffer defaults
    expect(typeof DEFAULT_CACHE_TTL_MS).toBe('number')
    expect(typeof DEFAULT_BUFFER_FLUSH_INTERVAL_MS).toBe('number')
    expect(typeof DEFAULT_CLEANUP_INTERVAL_MS).toBe('number')

    // Rate limiting defaults
    expect(typeof DEFAULT_RATE_LIMIT_WINDOW_MS).toBe('number')
    expect(typeof DEFAULT_FREE_TIER_REQUESTS).toBe('number')
    expect(typeof DEFAULT_PRO_TIER_REQUESTS).toBe('number')
    expect(typeof DEFAULT_ENTERPRISE_TIER_REQUESTS).toBe('number')

    // RPC & transport defaults
    expect(typeof DEFAULT_RPC_TIMEOUT_MS).toBe('number')
    expect(typeof DEFAULT_RECONNECT_DELAY_MS).toBe('number')
    expect(typeof DEFAULT_MAX_RECONNECT_DELAY_MS).toBe('number')
    expect(typeof DEFAULT_MAX_RECONNECT_ATTEMPTS).toBe('number')

    // WebSocket & connection defaults
    expect(typeof DEFAULT_HEARTBEAT_INTERVAL_MS).toBe('number')
    expect(typeof DEFAULT_CONNECTION_TIMEOUT_MS).toBe('number')

    // Storage & queue defaults
    expect(typeof DEFAULT_MAX_STORE_ENTRIES).toBe('number')
    expect(typeof DEFAULT_MAX_ERROR_AGE_MS).toBe('number')
    expect(typeof DEFAULT_MAX_BACKOFF_MS).toBe('number')
    expect(typeof DEFAULT_PROCESS_INTERVAL_MS).toBe('number')
    expect(typeof DEFAULT_COMPLETED_ITEM_MAX_AGE_MS).toBe('number')

    // CORS defaults
    expect(typeof DEFAULT_CORS_MAX_AGE_SECONDS).toBe('number')

    // Session & auth defaults
    expect(typeof DEFAULT_SESSION_MAX_AGE_SECONDS).toBe('number')
    expect(typeof DEFAULT_ORG_AI_TIMEOUT_MS).toBe('number')

    // Eval defaults
    expect(typeof DEFAULT_EVAL_TIMEOUT_MS).toBe('number')

    // Validation & size limit defaults
    expect(typeof DEFAULT_MAX_STRING_LENGTH).toBe('number')
    expect(typeof DEFAULT_MAX_OBJECT_DEPTH).toBe('number')
    expect(typeof DEFAULT_MAX_OBJECT_KEYS).toBe('number')
    expect(typeof DEFAULT_MAX_ARRAY_LENGTH).toBe('number')
    expect(typeof MAX_ID_LENGTH).toBe('number')
    expect(typeof MAX_TYPE_NAME_LENGTH).toBe('number')
    expect(typeof DEFAULT_PAGINATION_LIMIT).toBe('number')
    expect(typeof MAX_PAGINATION_LIMIT).toBe('number')
    expect(typeof DEFAULT_MAX_PIPELINE_DEPTH).toBe('number')

    // API key defaults
    expect(typeof API_KEY_PREFIX_LENGTH).toBe('number')
    expect(typeof API_KEY_SECRET_MIN_LENGTH).toBe('number')
    expect(typeof API_KEY_RANDOM_BYTES_LENGTH).toBe('number')
  })

  it('all time constants should be positive integers', () => {
    const allConstants = [
      MS_PER_SECOND,
      MS_PER_MINUTE,
      MS_PER_HOUR,
      MS_PER_DAY,
      SECONDS_PER_MINUTE,
      SECONDS_PER_HOUR,
      SECONDS_PER_DAY,
      DEFAULT_TEST_TIMEOUT_MS,
      DEFAULT_POLL_INTERVAL_MS,
      DEFAULT_RETRY_BASE_DELAY_MS,
      DEFAULT_RETRY_MAX_DELAY_MS,
      DEFAULT_MAX_RETRY_ATTEMPTS,
      DEFAULT_CACHE_TTL_MS,
      DEFAULT_BUFFER_FLUSH_INTERVAL_MS,
      DEFAULT_CLEANUP_INTERVAL_MS,
      DEFAULT_RATE_LIMIT_WINDOW_MS,
      DEFAULT_FREE_TIER_REQUESTS,
      DEFAULT_PRO_TIER_REQUESTS,
      DEFAULT_ENTERPRISE_TIER_REQUESTS,
      DEFAULT_RPC_TIMEOUT_MS,
      DEFAULT_RECONNECT_DELAY_MS,
      DEFAULT_MAX_RECONNECT_DELAY_MS,
      DEFAULT_MAX_RECONNECT_ATTEMPTS,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
      DEFAULT_CONNECTION_TIMEOUT_MS,
      DEFAULT_MAX_STORE_ENTRIES,
      DEFAULT_MAX_ERROR_AGE_MS,
      DEFAULT_MAX_BACKOFF_MS,
      DEFAULT_PROCESS_INTERVAL_MS,
      DEFAULT_COMPLETED_ITEM_MAX_AGE_MS,
      DEFAULT_CORS_MAX_AGE_SECONDS,
      DEFAULT_SESSION_MAX_AGE_SECONDS,
      DEFAULT_ORG_AI_TIMEOUT_MS,
      DEFAULT_EVAL_TIMEOUT_MS,
      DEFAULT_MAX_STRING_LENGTH,
      DEFAULT_MAX_OBJECT_DEPTH,
      DEFAULT_MAX_OBJECT_KEYS,
      DEFAULT_MAX_ARRAY_LENGTH,
      MAX_ID_LENGTH,
      MAX_TYPE_NAME_LENGTH,
      DEFAULT_PAGINATION_LIMIT,
      MAX_PAGINATION_LIMIT,
      DEFAULT_MAX_PIPELINE_DEPTH,
      API_KEY_PREFIX_LENGTH,
      API_KEY_SECRET_MIN_LENGTH,
      API_KEY_RANDOM_BYTES_LENGTH,
    ]

    for (const constant of allConstants) {
      expect(constant).toBeGreaterThan(0)
      expect(Number.isInteger(constant)).toBe(true)
    }
  })

  it('all millisecond constants should not be NaN or Infinity', () => {
    const msConstants = [
      MS_PER_SECOND,
      MS_PER_MINUTE,
      MS_PER_HOUR,
      MS_PER_DAY,
      DEFAULT_TEST_TIMEOUT_MS,
      DEFAULT_POLL_INTERVAL_MS,
      DEFAULT_RETRY_BASE_DELAY_MS,
      DEFAULT_RETRY_MAX_DELAY_MS,
      DEFAULT_CACHE_TTL_MS,
      DEFAULT_BUFFER_FLUSH_INTERVAL_MS,
      DEFAULT_CLEANUP_INTERVAL_MS,
      DEFAULT_RATE_LIMIT_WINDOW_MS,
      DEFAULT_RPC_TIMEOUT_MS,
      DEFAULT_RECONNECT_DELAY_MS,
      DEFAULT_MAX_RECONNECT_DELAY_MS,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
      DEFAULT_CONNECTION_TIMEOUT_MS,
      DEFAULT_MAX_ERROR_AGE_MS,
      DEFAULT_MAX_BACKOFF_MS,
      DEFAULT_PROCESS_INTERVAL_MS,
      DEFAULT_COMPLETED_ITEM_MAX_AGE_MS,
      DEFAULT_ORG_AI_TIMEOUT_MS,
      DEFAULT_EVAL_TIMEOUT_MS,
    ]

    for (const constant of msConstants) {
      expect(Number.isNaN(constant)).toBe(false)
      expect(Number.isFinite(constant)).toBe(true)
    }
  })
})
