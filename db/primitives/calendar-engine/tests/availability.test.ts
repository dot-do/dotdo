/**
 * AvailabilityStore Tests
 *
 * Tests for availability window management including:
 * - Schedule creation and management
 * - Availability rules
 * - Date-specific overrides
 * - Available slot calculation
 * - Buffer time handling
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  AvailabilityStore,
  createAvailabilityStore,
  type BusyPeriod,
} from '../availability'
import type { AvailabilitySchedule, TimeSlot, DayOfWeek } from '../types'

describe('AvailabilityStore', () => {
  let store: AvailabilityStore

  beforeEach(() => {
    store = createAvailabilityStore({ timezone: 'UTC' })
  })

  describe('Schedule Management', () => {
    it('should create a schedule', () => {
      const schedule = store.createSchedule({
        name: 'Work Hours',
        timezone: 'America/New_York',
        rules: [
          {
            id: 'rule1',
            days: [1, 2, 3, 4, 5], // Mon-Fri
            slots: [{ start: '09:00', end: '17:00' }],
          },
        ],
      })

      expect(schedule.id).toMatch(/^sched_/)
      expect(schedule.name).toBe('Work Hours')
      expect(schedule.timezone).toBe('America/New_York')
      expect(schedule.rules).toHaveLength(1)
      expect(schedule.createdAt).toBeInstanceOf(Date)
    })

    it('should get a schedule by ID', () => {
      const created = store.createSchedule({
        name: 'Test',
        timezone: 'UTC',
        rules: [],
      })

      const retrieved = store.getSchedule(created.id)
      expect(retrieved).toBeDefined()
      expect(retrieved?.name).toBe('Test')
    })

    it('should return undefined for non-existent schedule', () => {
      const schedule = store.getSchedule('non-existent')
      expect(schedule).toBeUndefined()
    })

    it('should update a schedule', () => {
      const schedule = store.createSchedule({
        name: 'Original',
        timezone: 'UTC',
        rules: [],
      })

      const updated = store.updateSchedule(schedule.id, {
        name: 'Updated',
        slotDuration: 30,
      })

      expect(updated?.name).toBe('Updated')
      expect(updated?.slotDuration).toBe(30)
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(schedule.createdAt.getTime())
    })

    it('should delete a schedule', () => {
      const schedule = store.createSchedule({
        name: 'To Delete',
        timezone: 'UTC',
        rules: [],
      })

      const deleted = store.deleteSchedule(schedule.id)
      expect(deleted).toBe(true)
      expect(store.getSchedule(schedule.id)).toBeUndefined()
    })

    it('should list all schedules', () => {
      store.createSchedule({ name: 'Schedule 1', timezone: 'UTC', rules: [] })
      store.createSchedule({ name: 'Schedule 2', timezone: 'UTC', rules: [] })

      const schedules = store.listSchedules()
      expect(schedules).toHaveLength(2)
    })
  })

  describe('Availability Rules', () => {
    let schedule: AvailabilitySchedule

    beforeEach(() => {
      schedule = store.createSchedule({
        name: 'Test',
        timezone: 'UTC',
        rules: [],
      })
    })

    it('should add a rule to schedule', () => {
      const rule = store.addRule(schedule.id, {
        days: [1, 2, 3, 4, 5],
        slots: [{ start: '09:00', end: '17:00' }],
      })

      expect(rule?.id).toMatch(/^rule_/)
      expect(rule?.days).toEqual([1, 2, 3, 4, 5])

      const updated = store.getSchedule(schedule.id)
      expect(updated?.rules).toHaveLength(1)
    })

    it('should update a rule', () => {
      const rule = store.addRule(schedule.id, {
        days: [1, 2, 3, 4, 5],
        slots: [{ start: '09:00', end: '17:00' }],
      })

      const updated = store.updateRule(schedule.id, rule!.id, {
        slots: [{ start: '08:00', end: '18:00' }],
      })

      expect(updated?.slots[0].start).toBe('08:00')
      expect(updated?.slots[0].end).toBe('18:00')
    })

    it('should remove a rule', () => {
      const rule = store.addRule(schedule.id, {
        days: [1, 2, 3, 4, 5],
        slots: [{ start: '09:00', end: '17:00' }],
      })

      const removed = store.removeRule(schedule.id, rule!.id)
      expect(removed).toBe(true)

      const updated = store.getSchedule(schedule.id)
      expect(updated?.rules).toHaveLength(0)
    })

    it('should handle rules with effective dates', () => {
      store.addRule(schedule.id, {
        days: [1, 2, 3, 4, 5],
        slots: [{ start: '09:00', end: '17:00' }],
        effectiveFrom: '2024-01-01',
        effectiveUntil: '2024-06-30',
      })

      const s = store.getSchedule(schedule.id)!

      // Date within range
      const jan15 = new Date('2024-01-15T12:00:00Z')
      const rules = store.getRulesForDate(s, jan15)
      expect(rules).toHaveLength(1)

      // Date outside range
      const jul15 = new Date('2024-07-15T12:00:00Z')
      const noRules = store.getRulesForDate(s, jul15)
      expect(noRules).toHaveLength(0)
    })

    it('should handle rule priority', () => {
      store.addRule(schedule.id, {
        days: [1, 2, 3, 4, 5],
        slots: [{ start: '09:00', end: '17:00' }],
        priority: 1,
      })

      store.addRule(schedule.id, {
        days: [1],
        slots: [{ start: '10:00', end: '16:00' }], // Special Monday hours
        priority: 2,
      })

      const s = store.getSchedule(schedule.id)!

      // On Monday, higher priority rule takes precedence
      const monday = new Date('2024-01-15T12:00:00Z')
      const slots = store.getSlotsForDate(s, monday)

      expect(slots).toHaveLength(1)
      expect(slots[0].start).toBe('10:00')
    })
  })

  describe('Overrides', () => {
    let schedule: AvailabilitySchedule

    beforeEach(() => {
      schedule = store.createSchedule({
        name: 'Test',
        timezone: 'UTC',
        rules: [
          {
            id: 'default',
            days: [1, 2, 3, 4, 5],
            slots: [{ start: '09:00', end: '17:00' }],
          },
        ],
      })
    })

    it('should add a date override', () => {
      const added = store.addOverride(schedule.id, {
        date: '2024-01-15',
        slots: [{ start: '10:00', end: '14:00' }],
        reason: 'Half day',
      })

      expect(added).toBe(true)

      const override = store.getOverride(schedule.id, '2024-01-15')
      expect(override?.slots[0].start).toBe('10:00')
      expect(override?.reason).toBe('Half day')
    })

    it('should mark day as unavailable with empty slots', () => {
      store.addOverride(schedule.id, {
        date: '2024-01-15',
        slots: [], // No availability
        reason: 'Holiday',
      })

      const s = store.getSchedule(schedule.id)!
      const monday = new Date('2024-01-15T12:00:00Z')
      const slots = store.getSlotsForDate(s, monday)

      expect(slots).toHaveLength(0)
    })

    it('should remove an override', () => {
      store.addOverride(schedule.id, {
        date: '2024-01-15',
        slots: [],
      })

      const removed = store.removeOverride(schedule.id, '2024-01-15')
      expect(removed).toBe(true)

      const override = store.getOverride(schedule.id, '2024-01-15')
      expect(override).toBeUndefined()
    })

    it('should replace existing override for same date', () => {
      store.addOverride(schedule.id, {
        date: '2024-01-15',
        slots: [{ start: '10:00', end: '14:00' }],
      })

      store.addOverride(schedule.id, {
        date: '2024-01-15',
        slots: [{ start: '11:00', end: '15:00' }],
      })

      const override = store.getOverride(schedule.id, '2024-01-15')
      expect(override?.slots[0].start).toBe('11:00')
    })
  })

  describe('Availability Windows', () => {
    let schedule: AvailabilitySchedule

    beforeEach(() => {
      schedule = store.createSchedule({
        name: 'Test',
        timezone: 'UTC',
        rules: [
          {
            id: 'weekday',
            days: [1, 2, 3, 4, 5],
            slots: [{ start: '09:00', end: '17:00' }],
          },
        ],
      })
    })

    it('should get availability windows for date range', () => {
      const start = new Date('2024-01-15T00:00:00Z') // Monday
      const end = new Date('2024-01-17T23:59:59Z') // Wednesday

      const windows = store.getAvailabilityWindows(schedule, start, end)

      expect(windows.length).toBeGreaterThanOrEqual(3)
      // Each window should be 8 hours (480 minutes)
      expect(windows[0].duration).toBe(480)
    })

    it('should exclude weekends', () => {
      const start = new Date('2024-01-13T00:00:00Z') // Saturday
      const end = new Date('2024-01-14T23:59:59Z') // Sunday

      const windows = store.getAvailabilityWindows(schedule, start, end)

      expect(windows).toHaveLength(0)
    })

    it('should handle partial day overlap', () => {
      const start = new Date('2024-01-15T12:00:00Z') // Monday noon
      const end = new Date('2024-01-15T20:00:00Z') // Monday 8pm

      const windows = store.getAvailabilityWindows(schedule, start, end)

      expect(windows).toHaveLength(1)
      // Should only include 12:00-17:00
      expect(windows[0].duration).toBe(300) // 5 hours
    })
  })

  describe('Available Slots', () => {
    let schedule: AvailabilitySchedule

    beforeEach(() => {
      schedule = store.createSchedule({
        name: 'Test',
        timezone: 'UTC',
        rules: [
          {
            id: 'weekday',
            days: [1, 2, 3, 4, 5],
            slots: [{ start: '09:00', end: '17:00' }],
          },
        ],
        slotDuration: 30,
      })
    })

    it('should generate available slots', () => {
      const start = new Date('2024-01-15T00:00:00Z')
      const end = new Date('2024-01-15T23:59:59Z')

      const slots = store.getAvailableSlots({
        scheduleId: schedule.id,
        start,
        end,
      })

      // 8 hours = 16 slots of 30 minutes each
      expect(slots).toHaveLength(16)
      expect(slots[0].duration).toBe(30)
    })

    it('should respect custom slot duration', () => {
      const start = new Date('2024-01-15T00:00:00Z')
      const end = new Date('2024-01-15T23:59:59Z')

      const slots = store.getAvailableSlots({
        scheduleId: schedule.id,
        start,
        end,
        duration: 60, // 1 hour slots
      })

      // 8 hours = 8 slots of 1 hour each
      expect(slots).toHaveLength(8)
      expect(slots[0].duration).toBe(60)
    })

    it('should subtract busy periods', () => {
      const start = new Date('2024-01-15T00:00:00Z')
      const end = new Date('2024-01-15T23:59:59Z')

      const busyPeriods: BusyPeriod[] = [
        {
          start: new Date('2024-01-15T10:00:00Z'),
          end: new Date('2024-01-15T11:00:00Z'),
          eventId: 'meeting1',
        },
      ]

      const slots = store.getAvailableSlots(
        { scheduleId: schedule.id, start, end },
        busyPeriods
      )

      // Should not include 10:00 and 10:30 slots
      const hasTenAM = slots.some(
        (s) => s.start.getUTCHours() === 10 && s.start.getUTCMinutes() === 0
      )
      expect(hasTenAM).toBe(false)
    })

    it('should apply buffer time', () => {
      // Update schedule with buffer
      store.updateSchedule(schedule.id, {
        buffer: { before: 15, after: 15 },
      })

      const start = new Date('2024-01-15T00:00:00Z')
      const end = new Date('2024-01-15T23:59:59Z')

      const busyPeriods: BusyPeriod[] = [
        {
          start: new Date('2024-01-15T10:00:00Z'),
          end: new Date('2024-01-15T11:00:00Z'),
        },
      ]

      const slots = store.getAvailableSlots(
        { scheduleId: schedule.id, start, end },
        busyPeriods
      )

      // 9:45 should also be blocked (15 min buffer before)
      const has945 = slots.some(
        (s) => s.start.getUTCHours() === 9 && s.start.getUTCMinutes() === 30
      )
      // With 30-min slots starting at 9:00, 9:30, etc., the 9:30 slot ends at 10:00
      // so it should be available, but 10:00 should be blocked
    })

    it('should respect minimum notice', () => {
      store.updateSchedule(schedule.id, {
        minimumNotice: 60, // 1 hour minimum notice
      })

      // Query starting from "now"
      const now = new Date()
      const start = now
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000)

      const slots = store.getAvailableSlots({
        scheduleId: schedule.id,
        start,
        end,
      })

      // All slots should be at least 1 hour from now
      for (const slot of slots) {
        expect(slot.start.getTime()).toBeGreaterThan(now.getTime() + 60 * 60 * 1000)
      }
    })

    it('should respect max days ahead', () => {
      store.updateSchedule(schedule.id, {
        maxDaysAhead: 7,
      })

      const start = new Date()
      const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

      const slots = store.getAvailableSlots({
        scheduleId: schedule.id,
        start,
        end,
      })

      // All slots should be within 7 days
      const maxDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      for (const slot of slots) {
        expect(slot.start.getTime()).toBeLessThan(maxDate.getTime())
      }
    })
  })

  describe('isAvailable', () => {
    let schedule: AvailabilitySchedule

    beforeEach(() => {
      schedule = store.createSchedule({
        name: 'Test',
        timezone: 'UTC',
        rules: [
          {
            id: 'weekday',
            days: [1, 2, 3, 4, 5],
            slots: [{ start: '09:00', end: '17:00' }],
          },
        ],
      })
    })

    it('should return true for available slot', () => {
      const start = new Date('2024-01-15T10:00:00Z')
      const end = new Date('2024-01-15T11:00:00Z')

      const available = store.isAvailable(schedule.id, start, end)
      expect(available).toBe(true)
    })

    it('should return false for unavailable slot', () => {
      const start = new Date('2024-01-15T18:00:00Z') // After hours
      const end = new Date('2024-01-15T19:00:00Z')

      const available = store.isAvailable(schedule.id, start, end)
      expect(available).toBe(false)
    })

    it('should return false when busy period conflicts', () => {
      const start = new Date('2024-01-15T10:00:00Z')
      const end = new Date('2024-01-15T11:00:00Z')

      const busyPeriods: BusyPeriod[] = [
        {
          start: new Date('2024-01-15T10:30:00Z'),
          end: new Date('2024-01-15T11:30:00Z'),
        },
      ]

      const available = store.isAvailable(schedule.id, start, end, busyPeriods)
      expect(available).toBe(false)
    })
  })

  describe('findNextAvailableSlot', () => {
    let schedule: AvailabilitySchedule

    beforeEach(() => {
      schedule = store.createSchedule({
        name: 'Test',
        timezone: 'UTC',
        rules: [
          {
            id: 'weekday',
            days: [1, 2, 3, 4, 5],
            slots: [{ start: '09:00', end: '17:00' }],
          },
        ],
        slotDuration: 30,
      })
    })

    it('should find next available slot', () => {
      const after = new Date('2024-01-15T12:00:00Z')

      const slot = store.findNextAvailableSlot(schedule.id, after, 30)

      expect(slot).toBeDefined()
      expect(slot!.start.getTime()).toBeGreaterThanOrEqual(after.getTime())
    })

    it('should skip busy periods', () => {
      const after = new Date('2024-01-15T10:00:00Z')

      const busyPeriods: BusyPeriod[] = [
        {
          start: new Date('2024-01-15T10:00:00Z'),
          end: new Date('2024-01-15T12:00:00Z'),
        },
      ]

      const slot = store.findNextAvailableSlot(schedule.id, after, 30, busyPeriods)

      expect(slot).toBeDefined()
      expect(slot!.start.getUTCHours()).toBeGreaterThanOrEqual(12)
    })
  })

  describe('Presets', () => {
    it('should create business hours schedule', () => {
      const schedule = store.createBusinessHoursSchedule(
        'Business Hours',
        'America/New_York',
        { startTime: '08:00', endTime: '18:00', includeSaturday: true }
      )

      expect(schedule.name).toBe('Business Hours')
      expect(schedule.rules[0].days).toContain(6) // Saturday included
      expect(schedule.rules[0].slots[0].start).toBe('08:00')
    })

    it('should create 24/7 schedule', () => {
      const schedule = store.create24x7Schedule('Always On', 'UTC')

      expect(schedule.rules[0].days).toHaveLength(7)
      expect(schedule.rules[0].slots[0].start).toBe('00:00')
      expect(schedule.rules[0].slots[0].end).toBe('23:59')
    })
  })
})
