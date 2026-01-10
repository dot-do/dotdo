/**
 * Approval Utility Functions Tests (RED phase - TDD)
 *
 * These tests define the contract for approval utility functions that will be
 * extracted from the duplicate implementations in:
 * - app/components/approvals/approval-card.tsx (lines 18-44)
 * - app/components/approvals/approval-detail.tsx (lines 37-95)
 *
 * Tests are expected to FAIL until the utilities are implemented in:
 * - app/lib/utils/approval.ts
 *
 * ## Expected Exports
 *
 * ```typescript
 * // Time formatting
 * export function formatRelativeTime(date: Date | null | undefined): string
 * export function formatTimeRemaining(expiresAt: Date | null | undefined): string
 *
 * // Configuration objects
 * export const priorityConfig: Record<ApprovalPriority, PriorityConfig>
 * export const statusConfig: Record<ApprovalStatus, StatusConfig>
 *
 * // Types
 * export interface PriorityConfig {
 *   label: string
 *   className: string
 *   borderClass?: string
 * }
 *
 * export interface StatusConfig {
 *   label: string
 *   className: string
 * }
 * ```
 *
 * @see app/lib/utils/approval.ts (implementation to be created)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import the utilities under test (will fail until implemented)
import {
  formatRelativeTime,
  formatTimeRemaining,
  priorityConfig,
  statusConfig,
} from '../../lib/utils/approval'

// Import types for type checking
import type { ApprovalPriority, ApprovalStatus } from '../../types/approval'

// =============================================================================
// Test Setup - Time Mocking
// =============================================================================

describe('Approval Utilities', () => {
  // Fixed "now" for consistent testing: January 15, 2026, 12:00:00 UTC
  const MOCK_NOW = new Date('2026-01-15T12:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(MOCK_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // formatRelativeTime Tests
  // ===========================================================================

  describe('formatRelativeTime', () => {
    describe('returns "Just now" for recent times', () => {
      it('returns "just now" for exactly now', () => {
        const result = formatRelativeTime(MOCK_NOW)
        expect(result.toLowerCase()).toBe('just now')
      })

      it('returns "just now" for 30 seconds ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 30 * 1000)
        const result = formatRelativeTime(date)
        expect(result.toLowerCase()).toBe('just now')
      })

      it('returns "just now" for 59 seconds ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 59 * 1000)
        const result = formatRelativeTime(date)
        expect(result.toLowerCase()).toBe('just now')
      })
    })

    describe('returns minutes ago format', () => {
      it('returns "1m ago" for 1 minute ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 60 * 1000)
        const result = formatRelativeTime(date)
        expect(result).toMatch(/1\s*m(in(ute)?s?)?\s*ago/i)
      })

      it('returns "5m ago" for 5 minutes ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 5 * 60 * 1000)
        const result = formatRelativeTime(date)
        expect(result).toMatch(/5\s*m(in(ute)?s?)?\s*ago/i)
      })

      it('returns "30m ago" for 30 minutes ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 30 * 60 * 1000)
        const result = formatRelativeTime(date)
        expect(result).toMatch(/30\s*m(in(ute)?s?)?\s*ago/i)
      })

      it('returns "59m ago" for 59 minutes ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 59 * 60 * 1000)
        const result = formatRelativeTime(date)
        expect(result).toMatch(/59\s*m(in(ute)?s?)?\s*ago/i)
      })
    })

    describe('returns hours ago format', () => {
      it('returns "1h ago" for 1 hour ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 60 * 60 * 1000)
        const result = formatRelativeTime(date)
        expect(result).toMatch(/1\s*h(our)?s?\s*ago/i)
      })

      it('returns "2h ago" for 2 hours ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 2 * 60 * 60 * 1000)
        const result = formatRelativeTime(date)
        expect(result).toMatch(/2\s*h(our)?s?\s*ago/i)
      })

      it('returns "12h ago" for 12 hours ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 12 * 60 * 60 * 1000)
        const result = formatRelativeTime(date)
        expect(result).toMatch(/12\s*h(our)?s?\s*ago/i)
      })

      it('returns "23h ago" for 23 hours ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 23 * 60 * 60 * 1000)
        const result = formatRelativeTime(date)
        expect(result).toMatch(/23\s*h(our)?s?\s*ago/i)
      })
    })

    describe('returns days ago format', () => {
      it('returns "1d ago" or "Yesterday" for 1 day ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 24 * 60 * 60 * 1000)
        const result = formatRelativeTime(date)
        // Accepts either "1d ago", "1 day ago", or "Yesterday"
        expect(result).toMatch(/1\s*d(ay)?s?\s*ago|yesterday/i)
      })

      it('returns "3d ago" for 3 days ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 3 * 24 * 60 * 60 * 1000)
        const result = formatRelativeTime(date)
        expect(result).toMatch(/3\s*d(ay)?s?\s*ago/i)
      })

      it('returns "6d ago" for 6 days ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 6 * 24 * 60 * 60 * 1000)
        const result = formatRelativeTime(date)
        expect(result).toMatch(/6\s*d(ay)?s?\s*ago/i)
      })
    })

    describe('returns formatted date for older times', () => {
      it('returns a formatted date for 7 days ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 7 * 24 * 60 * 60 * 1000)
        const result = formatRelativeTime(date)
        // Should return a localized date string, not "Xd ago"
        expect(result).not.toMatch(/\d+\s*d(ay)?s?\s*ago/i)
        // Should contain some kind of date format (month, day, year, or separators)
        expect(result).toMatch(/\d+/)
      })

      it('returns a formatted date for 30 days ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 30 * 24 * 60 * 60 * 1000)
        const result = formatRelativeTime(date)
        expect(result).not.toMatch(/\d+\s*d(ay)?s?\s*ago/i)
        expect(result).toMatch(/\d+/)
      })

      it('returns a formatted date for dates over a year ago', () => {
        const date = new Date(MOCK_NOW.getTime() - 400 * 24 * 60 * 60 * 1000)
        const result = formatRelativeTime(date)
        expect(result).not.toMatch(/ago/i)
        expect(result).toMatch(/\d+/)
      })
    })

    describe('edge cases', () => {
      it('handles null date gracefully', () => {
        const result = formatRelativeTime(null as unknown as Date)
        // Should return a fallback string, not throw
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
      })

      it('handles undefined date gracefully', () => {
        const result = formatRelativeTime(undefined as unknown as Date)
        // Should return a fallback string, not throw
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
      })

      it('handles string date input (ISO format)', () => {
        const dateString = '2026-01-15T11:55:00.000Z' // 5 minutes ago
        const result = formatRelativeTime(new Date(dateString))
        expect(result).toMatch(/5\s*m(in(ute)?s?)?\s*ago/i)
      })

      it('handles future dates (shows "just now" or appropriate format)', () => {
        const futureDate = new Date(MOCK_NOW.getTime() + 60 * 60 * 1000) // 1 hour in future
        const result = formatRelativeTime(futureDate)
        // Implementation may show "just now" or handle differently
        expect(typeof result).toBe('string')
      })
    })
  })

  // ===========================================================================
  // formatTimeRemaining Tests
  // ===========================================================================

  describe('formatTimeRemaining', () => {
    describe('returns "Expired" for past dates', () => {
      it('returns "Expired" when expires exactly now', () => {
        const result = formatTimeRemaining(MOCK_NOW)
        expect(result.toLowerCase()).toBe('expired')
      })

      it('returns "Expired" for 1 second in the past', () => {
        const pastDate = new Date(MOCK_NOW.getTime() - 1000)
        const result = formatTimeRemaining(pastDate)
        expect(result.toLowerCase()).toBe('expired')
      })

      it('returns "Expired" for 1 hour in the past', () => {
        const pastDate = new Date(MOCK_NOW.getTime() - 60 * 60 * 1000)
        const result = formatTimeRemaining(pastDate)
        expect(result.toLowerCase()).toBe('expired')
      })

      it('returns "Expired" for 1 day in the past', () => {
        const pastDate = new Date(MOCK_NOW.getTime() - 24 * 60 * 60 * 1000)
        const result = formatTimeRemaining(pastDate)
        expect(result.toLowerCase()).toBe('expired')
      })
    })

    describe('returns minutes remaining format', () => {
      it('returns "1m" or "1 minute" for 1 minute remaining', () => {
        const expiresAt = new Date(MOCK_NOW.getTime() + 60 * 1000)
        const result = formatTimeRemaining(expiresAt)
        expect(result).toMatch(/1\s*m(in(ute)?s?)?/i)
      })

      it('returns "5m" or "5 minutes" for 5 minutes remaining', () => {
        const expiresAt = new Date(MOCK_NOW.getTime() + 5 * 60 * 1000)
        const result = formatTimeRemaining(expiresAt)
        expect(result).toMatch(/5\s*m(in(ute)?s?)?/i)
      })

      it('returns "30m" or "30 minutes" for 30 minutes remaining', () => {
        const expiresAt = new Date(MOCK_NOW.getTime() + 30 * 60 * 1000)
        const result = formatTimeRemaining(expiresAt)
        expect(result).toMatch(/30\s*m(in(ute)?s?)?/i)
      })

      it('returns "59m" or "59 minutes" for 59 minutes remaining', () => {
        const expiresAt = new Date(MOCK_NOW.getTime() + 59 * 60 * 1000)
        const result = formatTimeRemaining(expiresAt)
        expect(result).toMatch(/59\s*m(in(ute)?s?)?/i)
      })
    })

    describe('returns hours remaining format', () => {
      it('returns "1h" or "1 hour" for 1 hour remaining', () => {
        const expiresAt = new Date(MOCK_NOW.getTime() + 60 * 60 * 1000)
        const result = formatTimeRemaining(expiresAt)
        expect(result).toMatch(/1\s*h(our)?s?/i)
      })

      it('returns "2h" or "2 hours" for 2 hours remaining', () => {
        const expiresAt = new Date(MOCK_NOW.getTime() + 2 * 60 * 60 * 1000)
        const result = formatTimeRemaining(expiresAt)
        expect(result).toMatch(/2\s*h(our)?s?/i)
      })

      it('returns "12h" or "12 hours" for 12 hours remaining', () => {
        const expiresAt = new Date(MOCK_NOW.getTime() + 12 * 60 * 60 * 1000)
        const result = formatTimeRemaining(expiresAt)
        expect(result).toMatch(/12\s*h(our)?s?/i)
      })

      it('returns "23h" or "23 hours" for 23 hours remaining', () => {
        const expiresAt = new Date(MOCK_NOW.getTime() + 23 * 60 * 60 * 1000)
        const result = formatTimeRemaining(expiresAt)
        expect(result).toMatch(/23\s*h(our)?s?/i)
      })
    })

    describe('returns days remaining format', () => {
      it('returns "1d" or "1 day" for 1 day remaining', () => {
        const expiresAt = new Date(MOCK_NOW.getTime() + 24 * 60 * 60 * 1000)
        const result = formatTimeRemaining(expiresAt)
        expect(result).toMatch(/1\s*d(ay)?s?/i)
      })

      it('returns "3d" or "3 days" for 3 days remaining', () => {
        const expiresAt = new Date(MOCK_NOW.getTime() + 3 * 24 * 60 * 60 * 1000)
        const result = formatTimeRemaining(expiresAt)
        expect(result).toMatch(/3\s*d(ay)?s?/i)
      })

      it('returns "7d" or "7 days" for 7 days remaining', () => {
        const expiresAt = new Date(MOCK_NOW.getTime() + 7 * 24 * 60 * 60 * 1000)
        const result = formatTimeRemaining(expiresAt)
        expect(result).toMatch(/7\s*d(ay)?s?/i)
      })

      it('returns "30d" or "30 days" for 30 days remaining', () => {
        const expiresAt = new Date(MOCK_NOW.getTime() + 30 * 24 * 60 * 60 * 1000)
        const result = formatTimeRemaining(expiresAt)
        expect(result).toMatch(/30\s*d(ay)?s?/i)
      })
    })

    describe('edge cases', () => {
      it('handles null date gracefully', () => {
        const result = formatTimeRemaining(null as unknown as Date)
        // Should return a fallback string (likely "Expired" or similar), not throw
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
      })

      it('handles undefined date gracefully', () => {
        const result = formatTimeRemaining(undefined as unknown as Date)
        // Should return a fallback string, not throw
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
      })

      it('handles string date input (ISO format)', () => {
        const dateString = '2026-01-15T13:00:00.000Z' // 1 hour in future
        const result = formatTimeRemaining(new Date(dateString))
        expect(result).toMatch(/1\s*h(our)?s?/i)
      })

      it('handles very small time remaining (under 1 minute)', () => {
        const expiresAt = new Date(MOCK_NOW.getTime() + 30 * 1000) // 30 seconds
        const result = formatTimeRemaining(expiresAt)
        // Should return something meaningful (could be "0m", "< 1m", or similar)
        expect(typeof result).toBe('string')
        // Should not be "Expired" since it's still in the future
        expect(result.toLowerCase()).not.toBe('expired')
      })
    })
  })

  // ===========================================================================
  // priorityConfig Tests
  // ===========================================================================

  describe('priorityConfig', () => {
    const priorities: ApprovalPriority[] = ['critical', 'high', 'normal', 'low']

    describe('contains all priority levels', () => {
      it.each(priorities)('has config for %s priority', (priority) => {
        expect(priorityConfig).toHaveProperty(priority)
      })
    })

    describe('critical priority', () => {
      it('has correct label', () => {
        expect(priorityConfig.critical.label).toBe('Critical')
      })

      it('has red-themed className', () => {
        expect(priorityConfig.critical.className).toMatch(/red/i)
      })

      it('has borderClass property (optional)', () => {
        // borderClass is used in approval-card.tsx for card border styling
        if (priorityConfig.critical.borderClass) {
          expect(priorityConfig.critical.borderClass).toMatch(/red/i)
        }
      })
    })

    describe('high priority', () => {
      it('has correct label', () => {
        expect(priorityConfig.high.label).toBe('High')
      })

      it('has orange-themed className', () => {
        expect(priorityConfig.high.className).toMatch(/orange/i)
      })

      it('has borderClass property (optional)', () => {
        if (priorityConfig.high.borderClass) {
          expect(priorityConfig.high.borderClass).toMatch(/orange/i)
        }
      })
    })

    describe('normal priority', () => {
      it('has correct label', () => {
        expect(priorityConfig.normal.label).toBe('Normal')
      })

      it('has blue-themed className', () => {
        expect(priorityConfig.normal.className).toMatch(/blue/i)
      })

      it('has borderClass property (optional)', () => {
        if (priorityConfig.normal.borderClass) {
          expect(priorityConfig.normal.borderClass).toMatch(/blue/i)
        }
      })
    })

    describe('low priority', () => {
      it('has correct label', () => {
        expect(priorityConfig.low.label).toBe('Low')
      })

      it('has gray-themed className', () => {
        expect(priorityConfig.low.className).toMatch(/gray/i)
      })

      it('has borderClass property (optional)', () => {
        if (priorityConfig.low.borderClass) {
          expect(priorityConfig.low.borderClass).toMatch(/gray/i)
        }
      })
    })

    describe('config structure validation', () => {
      it.each(priorities)('%s priority has label string', (priority) => {
        expect(typeof priorityConfig[priority].label).toBe('string')
        expect(priorityConfig[priority].label.length).toBeGreaterThan(0)
      })

      it.each(priorities)('%s priority has className string', (priority) => {
        expect(typeof priorityConfig[priority].className).toBe('string')
        expect(priorityConfig[priority].className.length).toBeGreaterThan(0)
      })

      it.each(priorities)('%s priority className contains Tailwind classes', (priority) => {
        // Should contain typical Tailwind patterns like bg-, text-, border-
        expect(priorityConfig[priority].className).toMatch(/bg-|text-|border-/)
      })
    })

    describe('handles unknown priorities gracefully', () => {
      it('returns undefined for unknown priority (or provide fallback)', () => {
        const unknownPriority = 'unknown' as ApprovalPriority
        // Either returns undefined or the implementation might have a fallback
        const config = priorityConfig[unknownPriority]
        // Test passes if undefined OR if there's a valid fallback config
        expect(config === undefined || (config && typeof config.label === 'string')).toBe(true)
      })
    })
  })

  // ===========================================================================
  // statusConfig Tests
  // ===========================================================================

  describe('statusConfig', () => {
    const statuses: ApprovalStatus[] = ['pending', 'approved', 'rejected', 'expired', 'escalated']

    describe('contains all status types', () => {
      it.each(statuses)('has config for %s status', (status) => {
        expect(statusConfig).toHaveProperty(status)
      })
    })

    describe('pending status', () => {
      it('has correct label', () => {
        expect(statusConfig.pending.label).toBe('Pending')
      })

      it('has yellow-themed className', () => {
        expect(statusConfig.pending.className).toMatch(/yellow/i)
      })
    })

    describe('approved status', () => {
      it('has correct label', () => {
        expect(statusConfig.approved.label).toBe('Approved')
      })

      it('has green-themed className', () => {
        expect(statusConfig.approved.className).toMatch(/green/i)
      })
    })

    describe('rejected status', () => {
      it('has correct label', () => {
        expect(statusConfig.rejected.label).toBe('Rejected')
      })

      it('has red-themed className', () => {
        expect(statusConfig.rejected.className).toMatch(/red/i)
      })
    })

    describe('expired status', () => {
      it('has correct label', () => {
        expect(statusConfig.expired.label).toBe('Expired')
      })

      it('has gray-themed className', () => {
        expect(statusConfig.expired.className).toMatch(/gray/i)
      })
    })

    describe('escalated status', () => {
      it('has correct label', () => {
        expect(statusConfig.escalated.label).toBe('Escalated')
      })

      it('has purple-themed className', () => {
        expect(statusConfig.escalated.className).toMatch(/purple/i)
      })
    })

    describe('config structure validation', () => {
      it.each(statuses)('%s status has label string', (status) => {
        expect(typeof statusConfig[status].label).toBe('string')
        expect(statusConfig[status].label.length).toBeGreaterThan(0)
      })

      it.each(statuses)('%s status has className string', (status) => {
        expect(typeof statusConfig[status].className).toBe('string')
        expect(statusConfig[status].className.length).toBeGreaterThan(0)
      })

      it.each(statuses)('%s status className contains Tailwind classes', (status) => {
        // Should contain typical Tailwind patterns like bg-, text-
        expect(statusConfig[status].className).toMatch(/bg-|text-/)
      })
    })

    describe('handles unknown statuses gracefully', () => {
      it('returns undefined for unknown status (or provide fallback)', () => {
        const unknownStatus = 'unknown' as ApprovalStatus
        // Either returns undefined or the implementation might have a fallback
        const config = statusConfig[unknownStatus]
        // Test passes if undefined OR if there's a valid fallback config
        expect(config === undefined || (config && typeof config.label === 'string')).toBe(true)
      })
    })
  })

  // ===========================================================================
  // Type Safety Tests
  // ===========================================================================

  describe('type safety', () => {
    it('priorityConfig keys match ApprovalPriority type', () => {
      const keys = Object.keys(priorityConfig)
      const expectedKeys: ApprovalPriority[] = ['critical', 'high', 'normal', 'low']
      expect(keys.sort()).toEqual(expectedKeys.sort())
    })

    it('statusConfig keys match ApprovalStatus type', () => {
      const keys = Object.keys(statusConfig)
      const expectedKeys: ApprovalStatus[] = ['pending', 'approved', 'rejected', 'expired', 'escalated']
      expect(keys.sort()).toEqual(expectedKeys.sort())
    })
  })

  // ===========================================================================
  // Integration-style Tests (ensure consistent behavior)
  // ===========================================================================

  describe('consistent behavior with components', () => {
    /**
     * These tests ensure the utility functions produce output consistent
     * with what the approval-card and approval-detail components expect.
     */

    it('formatRelativeTime output can be displayed in UI', () => {
      const dates = [
        new Date(MOCK_NOW.getTime() - 30 * 1000), // 30 seconds ago
        new Date(MOCK_NOW.getTime() - 5 * 60 * 1000), // 5 minutes ago
        new Date(MOCK_NOW.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
        new Date(MOCK_NOW.getTime() - 24 * 60 * 60 * 1000), // 1 day ago
      ]

      dates.forEach((date) => {
        const result = formatRelativeTime(date)
        // Should be a non-empty string suitable for display
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
        // Should not contain raw timestamp or NaN
        expect(result).not.toMatch(/NaN|undefined|null|Invalid/i)
      })
    })

    it('formatTimeRemaining output can be displayed in UI', () => {
      const expirations = [
        new Date(MOCK_NOW.getTime() + 30 * 1000), // 30 seconds
        new Date(MOCK_NOW.getTime() + 5 * 60 * 1000), // 5 minutes
        new Date(MOCK_NOW.getTime() + 2 * 60 * 60 * 1000), // 2 hours
        new Date(MOCK_NOW.getTime() + 24 * 60 * 60 * 1000), // 1 day
        new Date(MOCK_NOW.getTime() - 60 * 1000), // Expired
      ]

      expirations.forEach((expiresAt) => {
        const result = formatTimeRemaining(expiresAt)
        // Should be a non-empty string suitable for display
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
        // Should not contain raw timestamp or NaN
        expect(result).not.toMatch(/NaN|undefined|null|Invalid/i)
      })
    })

    it('priority configs can be used for Badge className', () => {
      const priorities: ApprovalPriority[] = ['critical', 'high', 'normal', 'low']

      priorities.forEach((priority) => {
        const config = priorityConfig[priority]
        // className should be usable as Tailwind classes
        expect(config.className).toBeDefined()
        // Should contain both background and text color
        expect(config.className).toMatch(/bg-/)
        expect(config.className).toMatch(/text-/)
      })
    })

    it('status configs can be used for Badge className', () => {
      const statuses: ApprovalStatus[] = ['pending', 'approved', 'rejected', 'expired', 'escalated']

      statuses.forEach((status) => {
        const config = statusConfig[status]
        // className should be usable as Tailwind classes
        expect(config.className).toBeDefined()
        // Should contain both background and text color
        expect(config.className).toMatch(/bg-/)
        expect(config.className).toMatch(/text-/)
      })
    })
  })
})
