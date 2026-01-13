/**
 * Protocol Constants
 */

// Message type prefixes
export const MSG_PREFIX = {
  SYNC: 0x00,
  AWARENESS: 0x01,
  AUTH: 0x02,
  QUERY: 0x03,
} as const

// Sync message types
export const SYNC_MSG = {
  STEP1: 0, // Request missing updates
  STEP2: 1, // Send requested updates
  UPDATE: 2, // Incremental update
} as const

// Awareness (presence) message types
export const AWARENESS_MSG = {
  UPDATE: 0,
  QUERY: 1,
} as const

// Connection states
export const CONNECTION_STATE = {
  CONNECTING: 0,
  CONNECTED: 1,
  DISCONNECTED: 2,
  RECONNECTING: 3,
} as const

// Default timeouts (ms)
export const TIMEOUTS = {
  HEARTBEAT_INTERVAL: 30_000,
  HEARTBEAT_TIMEOUT: 60_000,
  RECONNECT_BASE: 1_000,
  RECONNECT_MAX: 30_000,
  SYNC_DEBOUNCE: 50,
} as const

// Maximum sizes
export const LIMITS = {
  MAX_MESSAGE_SIZE: 1024 * 1024, // 1MB
  MAX_BATCH_SIZE: 100,
  MAX_HISTORY_LENGTH: 1000,
  MAX_PRESENCE_USERS: 100,
} as const
