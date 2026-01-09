/**
 * Utility functions for @dotdo/client SDK
 */

/**
 * Generate a unique ID for RPC messages
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

/**
 * Convert HTTP URL to WebSocket URL
 */
export function httpToWs(url: string): string {
  if (url.startsWith('https://')) {
    return 'wss://' + url.slice(8)
  }
  if (url.startsWith('http://')) {
    return 'ws://' + url.slice(7)
  }
  return url
}
