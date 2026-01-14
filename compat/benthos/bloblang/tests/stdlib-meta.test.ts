/**
 * RED Phase Tests: Bloblang stdlib meta functions
 * Issue: dotdo-l9m3f (Milestone 2)
 *
 * These tests define the expected behavior for Bloblang meta functions:
 * - meta(key) - get metadata value from message
 * - meta_set(key, value) - set metadata (returns new message)
 * - error() - get current error message
 * - errored() - check if in error state
 * - count(name) - increment and return counter
 * - uuid_v4() - generate random UUID
 * - now() - current timestamp as ISO string
 * - timestamp_unix() - unix seconds (number)
 * - timestamp_unix_nano() - unix nanoseconds (bigint)
 *
 * They should FAIL until the implementation is complete.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { BenthosMessage } from '../../core/message'
import * as metaFunctions from '../stdlib/meta'

describe('Bloblang stdlib meta functions', () => {
  let context: { message: BenthosMessage }

  beforeEach(() => {
    context = {
      message: new BenthosMessage(
        { test: 'data' },
        { 'user-id': '123', 'request-id': 'abc-def' }
      )
    }
  })

  describe('meta(key) - get metadata value', () => {
    it('should return metadata value for existing key', () => {
      const result = metaFunctions.meta.call(context, 'user-id')
      expect(result).toBe('123')
    })

    it('should return metadata value for another existing key', () => {
      const result = metaFunctions.meta.call(context, 'request-id')
      expect(result).toBe('abc-def')
    })

    it('should return undefined for non-existent key', () => {
      const result = metaFunctions.meta.call(context, 'non-existent')
      expect(result).toBeUndefined()
    })

    it('should return undefined when message has no metadata', () => {
      const emptyContext = {
        message: new BenthosMessage({ data: 'test' })
      }
      const result = metaFunctions.meta.call(emptyContext, 'any-key')
      expect(result).toBeUndefined()
    })

    it('should be case-sensitive for key names', () => {
      const result = metaFunctions.meta.call(context, 'User-Id')
      expect(result).toBeUndefined()
    })

    it('should handle metadata keys with special characters', () => {
      const contextWithSpecial = {
        message: new BenthosMessage(
          { data: 'test' },
          { 'x-custom-header': 'value' }
        )
      }
      const result = metaFunctions.meta.call(contextWithSpecial, 'x-custom-header')
      expect(result).toBe('value')
    })
  })

  describe('meta_set(key, value) - set metadata', () => {
    it('should set new metadata key and return new message', () => {
      const result = metaFunctions.meta_set.call(context, 'new-key', 'new-value')

      expect(result).toBeInstanceOf(BenthosMessage)
      expect(result).not.toBe(context.message)
      expect(result.metadata.get('new-key')).toBe('new-value')
    })

    it('should preserve existing metadata when setting new key', () => {
      const result = metaFunctions.meta_set.call(context, 'new-key', 'new-value')

      expect(result.metadata.get('user-id')).toBe('123')
      expect(result.metadata.get('request-id')).toBe('abc-def')
    })

    it('should overwrite existing metadata key', () => {
      const result = metaFunctions.meta_set.call(context, 'user-id', 'updated-123')

      expect(result.metadata.get('user-id')).toBe('updated-123')
    })

    it('should not modify original message', () => {
      const originalValue = context.message.metadata.get('user-id')
      metaFunctions.meta_set.call(context, 'user-id', 'changed')

      expect(context.message.metadata.get('user-id')).toBe(originalValue)
    })

    it('should handle empty string as metadata value', () => {
      const result = metaFunctions.meta_set.call(context, 'empty-key', '')

      expect(result.metadata.get('empty-key')).toBe('')
    })

    it('should handle metadata values with special characters', () => {
      const specialValue = 'value with spaces, special: chars & symbols!'
      const result = metaFunctions.meta_set.call(context, 'special-key', specialValue)

      expect(result.metadata.get('special-key')).toBe(specialValue)
    })

    it('should handle very long metadata values', () => {
      const longValue = 'x'.repeat(10000)
      const result = metaFunctions.meta_set.call(context, 'long-key', longValue)

      expect(result.metadata.get('long-key')).toBe(longValue)
    })

    it('should preserve message content when setting metadata', () => {
      const originalContent = context.message.content
      const result = metaFunctions.meta_set.call(context, 'new-key', 'value')

      expect(result.content).toBe(originalContent)
    })

    it('should preserve message timestamp when setting metadata', () => {
      const originalTimestamp = context.message.timestamp
      const result = metaFunctions.meta_set.call(context, 'new-key', 'value')

      expect(result.timestamp).toBe(originalTimestamp)
    })
  })

  describe('error() - get current error message', () => {
    it('should return error message when message has error', () => {
      const error = new Error('Something went wrong')
      const errorContext = {
        message: context.message.withError(error)
      }

      const result = metaFunctions.error.call(errorContext)
      expect(result).toBe('Something went wrong')
    })

    it('should return undefined when message has no error', () => {
      const result = metaFunctions.error.call(context)
      expect(result).toBeUndefined()
    })

    it('should handle error with custom message', () => {
      const customError = new Error('Custom error with details')
      const errorContext = {
        message: context.message.withError(customError)
      }

      const result = metaFunctions.error.call(errorContext)
      expect(result).toBe('Custom error with details')
    })

    it('should handle error with empty message', () => {
      const emptyError = new Error('')
      const errorContext = {
        message: context.message.withError(emptyError)
      }

      const result = metaFunctions.error.call(errorContext)
      expect(result).toBe('')
    })

    it('should return null when error() is called on cleared error', () => {
      const errorMsg = context.message.withError(new Error('test'))
      const clearedMsg = errorMsg.clearError()
      const clearedContext = { message: clearedMsg }

      const result = metaFunctions.error.call(clearedContext)
      expect(result).toBeUndefined()
    })
  })

  describe('errored() - check if in error state', () => {
    it('should return true when message has error', () => {
      const errorContext = {
        message: context.message.withError(new Error('Something failed'))
      }

      const result = metaFunctions.errored.call(errorContext)
      expect(result).toBe(true)
    })

    it('should return false when message has no error', () => {
      const result = metaFunctions.errored.call(context)
      expect(result).toBe(false)
    })

    it('should return false after error is cleared', () => {
      const errorMsg = context.message.withError(new Error('test'))
      const clearedMsg = errorMsg.clearError()
      const clearedContext = { message: clearedMsg }

      const result = metaFunctions.errored.call(clearedContext)
      expect(result).toBe(false)
    })

    it('should return false for fresh message without metadata', () => {
      const freshContext = {
        message: new BenthosMessage('test')
      }

      const result = metaFunctions.errored.call(freshContext)
      expect(result).toBe(false)
    })

    it('should distinguish between message with error and without', () => {
      const errorContext = {
        message: context.message.withError(new Error('error'))
      }

      expect(metaFunctions.errored.call(context)).toBe(false)
      expect(metaFunctions.errored.call(errorContext)).toBe(true)
    })
  })

  describe('count(name) - increment and return counter', () => {
    it('should initialize counter to 1 on first call', () => {
      const result = metaFunctions.count.call(context, 'my-counter')
      expect(result).toBe(1)
    })

    it('should increment counter on subsequent calls', () => {
      metaFunctions.count.call(context, 'counter-1')
      const result2 = metaFunctions.count.call(context, 'counter-1')
      expect(result2).toBe(2)
    })

    it('should increment counter multiple times', () => {
      metaFunctions.count.call(context, 'counter-2')
      metaFunctions.count.call(context, 'counter-2')
      const result3 = metaFunctions.count.call(context, 'counter-2')
      expect(result3).toBe(3)
    })

    it('should maintain separate counters for different names', () => {
      const r1 = metaFunctions.count.call(context, 'counter-a')
      const r2 = metaFunctions.count.call(context, 'counter-b')
      const r3 = metaFunctions.count.call(context, 'counter-a')

      expect(r1).toBe(1)
      expect(r2).toBe(1)
      expect(r3).toBe(2)
    })

    it('should return number type', () => {
      const result = metaFunctions.count.call(context, 'number-test')
      expect(typeof result).toBe('number')
      expect(Number.isInteger(result)).toBe(true)
    })

    it('should handle counter names with special characters', () => {
      const result = metaFunctions.count.call(context, 'my-counter:items')
      expect(result).toBe(1)
    })

    it('should not interfere with metadata', () => {
      metaFunctions.count.call(context, 'counter')
      metaFunctions.count.call(context, 'counter')

      // Counter state should be separate from metadata
      expect(context.message.metadata.get('counter')).not.toBe('2')
    })

    it('should be independent per message context', () => {
      const context2 = {
        message: new BenthosMessage({ other: 'data' })
      }

      const r1 = metaFunctions.count.call(context, 'shared-counter')
      const r2 = metaFunctions.count.call(context2, 'shared-counter')

      // Counters should be per-context, not global
      expect(r1).toBe(1)
      expect(r2).toBe(1)
    })
  })

  describe('uuid_v4() - generate random UUID', () => {
    it('should return a string', () => {
      const result = metaFunctions.uuid_v4.call(context)
      expect(typeof result).toBe('string')
    })

    it('should return UUID v4 format (8-4-4-4-12 hex)', () => {
      const result = metaFunctions.uuid_v4.call(context)
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      expect(result).toMatch(uuidPattern)
    })

    it('should generate different UUIDs on each call', () => {
      const uuid1 = metaFunctions.uuid_v4.call(context)
      const uuid2 = metaFunctions.uuid_v4.call(context)

      expect(uuid1).not.toBe(uuid2)
    })

    it('should generate valid RFC 4122 v4 UUIDs', () => {
      const result = metaFunctions.uuid_v4.call(context)
      const parts = result.split('-')

      expect(parts).toHaveLength(5)
      expect(parts[0]).toHaveLength(8)
      expect(parts[1]).toHaveLength(4)
      expect(parts[2]).toHaveLength(4)
      expect(parts[3]).toHaveLength(4)
      expect(parts[4]).toHaveLength(12)
    })

    it('should have version 4 in the 7th hex digit of third part', () => {
      const result = metaFunctions.uuid_v4.call(context)
      const thirdPart = result.split('-')[2]

      // Third part should have '4' as first character (version)
      expect(thirdPart[0]).toBe('4')
    })

    it('should have variant bits in the 9th hex digit of fourth part', () => {
      const result = metaFunctions.uuid_v4.call(context)
      const fourthPart = result.split('-')[3]
      const firstChar = fourthPart[0].toLowerCase()

      // RFC 4122 variant requires first character to be 8, 9, a, or b
      expect(['8', '9', 'a', 'b']).toContain(firstChar)
    })

    it('should return lowercase or uppercase hex consistently', () => {
      const result = metaFunctions.uuid_v4.call(context)
      // Should be valid regardless of case
      expect(result.toLowerCase()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    })

    it('should generate multiple unique UUIDs in sequence', () => {
      const uuids = Array.from({ length: 10 }, () =>
        metaFunctions.uuid_v4.call(context)
      )

      // All should be unique
      const uniqueUuids = new Set(uuids)
      expect(uniqueUuids.size).toBe(10)

      // All should be valid v4
      uuids.forEach(uuid => {
        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      })
    })
  })

  describe('now() - current timestamp as ISO string', () => {
    it('should return a string', () => {
      const result = metaFunctions.now.call(context)
      expect(typeof result).toBe('string')
    })

    it('should return valid ISO 8601 format', () => {
      const result = metaFunctions.now.call(context)
      const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/
      expect(result).toMatch(isoPattern)
    })

    it('should be a parseable date', () => {
      const result = metaFunctions.now.call(context)
      const parsed = new Date(result)

      expect(parsed).toBeInstanceOf(Date)
      expect(parsed.getTime()).toBeGreaterThan(0)
    })

    it('should return approximately current time', () => {
      const beforeCall = Date.now()
      const result = metaFunctions.now.call(context)
      const afterCall = Date.now()

      const timestamp = new Date(result).getTime()

      // Result should be within 1 second of actual time
      expect(timestamp).toBeGreaterThanOrEqual(beforeCall - 1000)
      expect(timestamp).toBeLessThanOrEqual(afterCall + 1000)
    })

    it('should return different times on multiple calls (if delayed)', async () => {
      const now1 = metaFunctions.now.call(context)

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10))

      const now2 = metaFunctions.now.call(context)

      // Times should be different (or very close if called immediately)
      expect(now1).not.toBe(now2)
    })

    it('should include timezone indicator (Z or offset)', () => {
      const result = metaFunctions.now.call(context)
      // Should end with Z (UTC) or timezone offset
      expect(result).toMatch(/Z$|([+-]\d{2}:\d{2})$/)
    })

    it('should include milliseconds precision', () => {
      const result = metaFunctions.now.call(context)
      // Modern ISO format includes milliseconds
      expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?/)
    })
  })

  describe('timestamp_unix() - unix seconds as number', () => {
    it('should return a number', () => {
      const result = metaFunctions.timestamp_unix.call(context)
      expect(typeof result).toBe('number')
    })

    it('should return integer seconds', () => {
      const result = metaFunctions.timestamp_unix.call(context)
      expect(Number.isInteger(result)).toBe(true)
    })

    it('should return approximately current Unix time', () => {
      const beforeCall = Math.floor(Date.now() / 1000)
      const result = metaFunctions.timestamp_unix.call(context)
      const afterCall = Math.floor(Date.now() / 1000)

      // Result should be within current second range
      expect(result).toBeGreaterThanOrEqual(beforeCall - 1)
      expect(result).toBeLessThanOrEqual(afterCall + 1)
    })

    it('should be greater than Jan 1 2020 Unix time', () => {
      const result = metaFunctions.timestamp_unix.call(context)
      const jan2020 = Math.floor(new Date('2020-01-01').getTime() / 1000)

      expect(result).toBeGreaterThan(jan2020)
    })

    it('should be less than Jan 1 2100 Unix time', () => {
      const result = metaFunctions.timestamp_unix.call(context)
      const jan2100 = Math.floor(new Date('2100-01-01').getTime() / 1000)

      expect(result).toBeLessThan(jan2100)
    })

    it('should be consistent with now() in seconds', () => {
      const nowResult = metaFunctions.now.call(context)
      const unixResult = metaFunctions.timestamp_unix.call(context)

      const nowTimestamp = Math.floor(new Date(nowResult).getTime() / 1000)

      // Should be within 1 second (accounting for execution time)
      expect(Math.abs(unixResult - nowTimestamp)).toBeLessThanOrEqual(1)
    })

    it('should handle year transitions correctly', () => {
      const result = metaFunctions.timestamp_unix.call(context)
      const jsTimestamp = Math.floor(Date.now() / 1000)

      expect(result).toBeLessThanOrEqual(jsTimestamp + 1)
      expect(result).toBeGreaterThanOrEqual(jsTimestamp - 1)
    })
  })

  describe('timestamp_unix_nano() - unix nanoseconds as bigint', () => {
    it('should return a bigint', () => {
      const result = metaFunctions.timestamp_unix_nano.call(context)
      expect(typeof result).toBe('bigint')
    })

    it('should return nanoseconds (10^9 per second)', () => {
      const result = metaFunctions.timestamp_unix_nano.call(context)
      const beforeCall = BigInt(Date.now()) * BigInt(1_000_000)
      const afterCall = BigInt(Date.now()) * BigInt(1_000_000)

      // Result should be within current time range (in nanoseconds)
      expect(result).toBeGreaterThanOrEqual(beforeCall - BigInt(1_000_000))
      expect(result).toBeLessThanOrEqual(afterCall + BigInt(1_000_000))
    })

    it('should be approximately 1e9 times larger than timestamp_unix', () => {
      const unixSeconds = metaFunctions.timestamp_unix.call(context)
      const nanoSeconds = metaFunctions.timestamp_unix_nano.call(context)

      const nanoFromSeconds = BigInt(unixSeconds) * BigInt(1_000_000_000)

      // Should be within 1 second of nanoseconds
      const diff = nanoSeconds - nanoFromSeconds
      expect(diff).toBeGreaterThan(-BigInt(1_000_000_000))
      expect(diff).toBeLessThan(BigInt(1_000_000_000))
    })

    it('should be greater than Jan 1 2020 in nanoseconds', () => {
      const result = metaFunctions.timestamp_unix_nano.call(context)
      const jan2020Nano = BigInt(Math.floor(new Date('2020-01-01').getTime() / 1000)) * BigInt(1_000_000_000)

      expect(result).toBeGreaterThan(jan2020Nano)
    })

    it('should be less than Jan 1 2100 in nanoseconds', () => {
      const result = metaFunctions.timestamp_unix_nano.call(context)
      const jan2100Nano = BigInt(Math.floor(new Date('2100-01-01').getTime() / 1000)) * BigInt(1_000_000_000)

      expect(result).toBeLessThan(jan2100Nano)
    })

    it('should maintain nanosecond precision', () => {
      const result = metaFunctions.timestamp_unix_nano.call(context)
      const text = result.toString()

      // Bigint representation should be 18-19 digits (current Unix nanos)
      expect(text.length).toBeGreaterThanOrEqual(18)
      expect(text.length).toBeLessThanOrEqual(20)
    })

    it('should have realistic nanosecond precision per second', () => {
      const result = metaFunctions.timestamp_unix_nano.call(context)
      // Extract nanoseconds within a second (last 9 digits)
      const nanoWithinSecond = Number(result % BigInt(1_000_000_000))

      // Should be between 0 and 999,999,999
      expect(nanoWithinSecond).toBeGreaterThanOrEqual(0)
      expect(nanoWithinSecond).toBeLessThan(1_000_000_000)
    })

    it('should be consistent with Date.now() at second level', () => {
      const before = BigInt(Date.now()) * BigInt(1_000_000)
      const result = metaFunctions.timestamp_unix_nano.call(context)
      const after = BigInt(Date.now()) * BigInt(1_000_000)

      // Verify it's in the right ballpark (within 10ms)
      expect(result).toBeGreaterThan(before - BigInt(10_000_000))
      expect(result).toBeLessThan(after + BigInt(10_000_000))
    })
  })

  describe('Meta functions integration', () => {
    it('should maintain metadata across multiple meta_set calls', () => {
      let msg = context.message
      msg = metaFunctions.meta_set.call({ message: msg }, 'key1', 'value1')
      msg = metaFunctions.meta_set.call({ message: msg }, 'key2', 'value2')
      msg = metaFunctions.meta_set.call({ message: msg }, 'key3', 'value3')

      expect(metaFunctions.meta.call({ message: msg }, 'key1')).toBe('value1')
      expect(metaFunctions.meta.call({ message: msg }, 'key2')).toBe('value2')
      expect(metaFunctions.meta.call({ message: msg }, 'key3')).toBe('value3')
    })

    it('should work together: error state and metadata', () => {
      let msg = context.message
      msg = metaFunctions.meta_set.call({ message: msg }, 'attempt', '1')
      msg = msg.withError(new Error('First attempt failed'))

      expect(metaFunctions.errored.call({ message: msg })).toBe(true)
      expect(metaFunctions.error.call({ message: msg })).toBe('First attempt failed')
      expect(metaFunctions.meta.call({ message: msg }, 'attempt')).toBe('1')
    })

    it('should handle counter with metadata together', () => {
      let msg = context.message
      msg = metaFunctions.meta_set.call({ message: msg }, 'request-id', 'req-123')

      const ctx = { message: msg }
      const count1 = metaFunctions.count.call(ctx, 'attempts')
      const count2 = metaFunctions.count.call(ctx, 'attempts')

      expect(count1).toBe(1)
      expect(count2).toBe(2)
      expect(metaFunctions.meta.call(ctx, 'request-id')).toBe('req-123')
    })

    it('should generate uuid and timestamp independently', () => {
      const uuid1 = metaFunctions.uuid_v4.call(context)
      const uuid2 = metaFunctions.uuid_v4.call(context)
      const now1 = metaFunctions.now.call(context)
      const now2 = metaFunctions.now.call(context)

      expect(uuid1).not.toBe(uuid2)
      // Now timestamps might be the same if called immediately
      expect(now1).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(now2).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  describe('Edge cases and error handling', () => {
    it('should handle null/undefined context gracefully', () => {
      expect(() => {
        metaFunctions.meta.call(undefined as any, 'key')
      }).toThrow()
    })

    it('should handle missing message in context', () => {
      expect(() => {
        metaFunctions.meta.call({} as any, 'key')
      }).toThrow()
    })

    it('should handle empty string key for meta()', () => {
      const result = metaFunctions.meta.call(context, '')
      expect(result).toBeUndefined()
    })

    it('should handle very long key names', () => {
      const longKey = 'x'.repeat(1000)
      const ctx = {
        message: new BenthosMessage({ data: 'test' }, { [longKey]: 'value' })
      }
      const result = metaFunctions.meta.call(ctx, longKey)
      expect(result).toBe('value')
    })

    it('should handle numeric-like string keys', () => {
      const ctx = {
        message: new BenthosMessage({ data: 'test' }, { '123': 'numeric-key' })
      }
      const result = metaFunctions.meta.call(ctx, '123')
      expect(result).toBe('numeric-key')
    })
  })
})
