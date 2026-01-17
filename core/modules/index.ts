/**
 * Core Modules Index
 *
 * This file exports all extracted modules from DOCore.
 * Each module follows the RpcTarget pattern for cross-DO communication.
 *
 * Re-exports module implementations and their interfaces from types/modules.ts
 */

// Module Implementations
export {
  DOCoreEvents,
  createOnProxy,
  generateEventId,
  generateThingId,
} from './events'

export {
  DOCoreSchedule,
  type PersistedSchedule,
  DAY_MAP,
  parseTime,
} from './schedule'

export {
  DOCoreStorage,
  type StorageEventEmitter,
  type ThingQueryOptions,
} from './storage'

// Type Interfaces (primary exports from types/modules.ts)
export type {
  IStorage,
  ISchedule,
  IEvents,
  Event,
  EventHandler,
  OnProxy,
  Unsubscribe,
  QueryOperator,
  ScheduleHandler,
  ScheduleEntry,
  PersistedScheduleEntry,
  IntervalBuilder,
  TimeBuilder,
  ScheduleBuilder,
  StorageQueryOptions,
  BulkFilterOptions,
  StorageModuleOptions,
  ScheduleModuleOptions,
  EventsModuleOptions,
} from '../types/modules'
