/**
 * Core Modules Index
 *
 * This file exports all extracted modules from DOCore.
 * Each module follows the RpcTarget pattern for cross-DO communication.
 */

// Events module
export {
  DOCoreEvents,
  type Event,
  type EventHandler,
  type OnProxy,
  generateEventId,
  generateThingId,
  createOnProxy,
} from './events'

// Schedule module
export {
  DOCoreSchedule,
  type PersistedSchedule,
  type ScheduleHandler,
  type ScheduleEntry,
  type TimeBuilder,
  type ScheduleBuilder,
  type IntervalBuilder,
  DAY_MAP,
  parseTime,
} from './schedule'

// Storage module
export {
  DOCoreStorage,
  type StorageEventEmitter,
  type ThingQueryOptions,
} from './storage'
