import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createContext, type WorkflowContext } from '../context'

// Mock DurableObjectState
const mockState = {
  id: { toString: () => 'test-id' },
  storage: {
    get: vi.fn(),
    put: vi.fn(),
    list: vi.fn(() => Promise.resolve(new Map())),
  },
} as unknown as DurableObjectState

describe('$.every scheduling DSL', () => {
  let $: WorkflowContext

  beforeEach(() => {
    $ = createContext(mockState, {})
  })

  describe('$.every.hour pattern', () => {
    it('should register handler for every.hour', () => {
      const handler = async () => {}
      $.every.hour(handler)

      // Access internal schedule registry
      const schedules = ($._schedules as Map<string, any>)
      expect(schedules.size).toBe(1)

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 * * * *',
        natural: 'hour',
      })
    })

    it('should register handler for every.day', () => {
      $.every.day(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 0 * * *',
        natural: 'day',
      })
    })

    it('should register handler for every.minute', () => {
      $.every.minute(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '* * * * *',
        natural: 'minute',
      })
    })

    it('should register handler for every.week', () => {
      $.every.week(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 0 * * 0',
        natural: 'week',
      })
    })
  })

  describe('$.every.Monday pattern', () => {
    it('should register handler for every.Monday', () => {
      $.every.Monday(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 0 * * 1',
        natural: 'Monday',
      })
    })

    it('should register handler for every.Friday', () => {
      $.every.Friday(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 0 * * 5',
        natural: 'Friday',
      })
    })

    it('should register handler for every.weekday', () => {
      $.every.weekday(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 0 * * 1-5',
        natural: 'weekday',
      })
    })
  })

  describe('$.every.Monday.at9am pattern', () => {
    it('should register handler for every.Monday.at9am', () => {
      $.every.Monday.at9am(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 9 * * 1',
        natural: 'Monday.at9am',
      })
    })

    it('should register handler for every.Friday.at5pm', () => {
      $.every.Friday.at5pm(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 17 * * 5',
        natural: 'Friday.at5pm',
      })
    })

    it('should register handler for every.weekday.at8am', () => {
      $.every.weekday.at8am(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 8 * * 1-5',
        natural: 'weekday.at8am',
      })
    })

    it('should register handler for every.day.at("6pm")', () => {
      $.every.day.at('6pm')(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 18 * * *',
        natural: 'day.at(6pm)',
      })
    })

    it('should handle dynamic time with at("3:45pm")', () => {
      $.every.Monday.at('3:45pm')(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '45 15 * * 1',
        natural: 'Monday.at(3:45pm)',
      })
    })
  })

  describe('$.every(5).minutes pattern', () => {
    it('should register handler for every(5).minutes', () => {
      $.every(5).minutes(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'minute',
        value: 5,
        natural: '5 minutes',
      })
    })

    it('should register handler for every(30).minutes', () => {
      $.every(30).minutes(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'minute',
        value: 30,
        natural: '30 minutes',
      })
    })

    it('should register handler for every(2).hours', () => {
      $.every(2).hours(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'hour',
        value: 2,
        natural: '2 hours',
      })
    })

    it('should register handler for every(10).seconds', () => {
      $.every(10).seconds(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'second',
        value: 10,
        natural: '10 seconds',
      })
    })
  })

  describe('$.every.week.on.Friday.at("3pm") pattern', () => {
    it('should register handler for every.week.on.Friday.at("3pm")', () => {
      $.every.week.on.Friday.at('3pm')(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 15 * * 5',
        natural: 'week.on.Friday.at(3pm)',
      })
    })

    it('should register handler for every.week.on.Monday.at("9am")', () => {
      $.every.week.on.Monday.at('9am')(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 9 * * 1',
        natural: 'week.on.Monday.at(9am)',
      })
    })
  })

  describe('multiple handlers', () => {
    it('should support multiple schedule registrations', () => {
      $.every.hour(async () => {})
      $.every.day(async () => {})
      $.every.Monday.at9am(async () => {})

      const schedules = ($._schedules as Map<string, any>)
      expect(schedules.size).toBe(3)
    })

    it('should track each handler separately', () => {
      const handler1 = async () => {}
      const handler2 = async () => {}

      $.every.hour(handler1)
      $.every.day(handler2)

      const schedules = ($._schedules as Map<string, any>)
      const values = Array.from(schedules.values())

      expect(values[0].handler).toBe(handler1)
      expect(values[1].handler).toBe(handler2)
    })
  })

  describe('chaining support', () => {
    it('should allow property chaining', () => {
      expect($.every.Monday).toBeDefined()
      expect(typeof $.every.Monday).toBe('function')
      expect($.every.Monday.at9am).toBeDefined()
      expect(typeof $.every.Monday.at9am).toBe('function')
    })

    it('should allow on chaining for week patterns', () => {
      expect($.every.week.on).toBeDefined()
      expect($.every.week.on.Friday).toBeDefined()
    })

    it('should allow numeric patterns', () => {
      expect(typeof $.every(5)).toBe('object')
      expect(typeof $.every(5).minutes).toBe('function')
    })
  })
})
