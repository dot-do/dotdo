/**
 * Schedule DSL - Re-exports from workflow module
 *
 * This file maintains backward compatibility by re-exporting
 * the scheduling DSL from the new workflow/ module.
 *
 * @module do/schedule
 */

// Re-export everything from the workflow schedule module
export {
  createEveryProxy,
  getSchedules,
  getScheduleCount,
  clearSchedules,
  executeSchedule,
  type ScheduleHandler,
  type ScheduleInterval,
  type ScheduleRegistration,
} from './workflow/schedule'
