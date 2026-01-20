// @dotdo/do - THE Durable Object for Digital Objects
// DO = Durable Object = Digital Object

export { DO, type DOEnv, type DOOptions } from './DO'
export { createContext, type WorkflowContext } from './context'
export type { $ } from './context'
export { EntityManager, withEntities } from './entities'

// WebSocket management
export {
  WebSocketManager,
  type WebSocketMessage,
  type WebSocketHandler,
  type BroadcastResult
} from './websocket'

// Event handler system ($.on.Noun.verb)
export {
  createOnProxy,
  matchHandlers,
  invokeHandlers,
  getEventTypes,
  getHandlerCount,
  clearHandlers,
  clearAllHandlers,
  type OnProxy,
  type EventHandler,
  type NounEventProxy
} from './on'

// Scheduling DSL ($.every.Monday.at9am)
export {
  createEveryProxy,
  type ScheduleHandler,
  type ScheduleInterval,
  type ScheduleRegistration
} from './schedule'

// Admin interface hooks
export {
  AdminDO,
  createAdminHooks,
  type AdminStores,
  type EntityListOptions,
  type EntityListResult,
  type EventListOptions,
  type EventListResult,
  type RelationshipListOptions,
  type RelationshipListResult,
  type EmitEventOptions,
  type StateInspection,
  type HealthCheck
} from './admin'
