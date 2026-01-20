/**
 * Event handler registration - Re-exports from workflow module
 *
 * This file maintains backward compatibility by re-exporting
 * the event handler DSL from the new workflow/ module.
 *
 * @module do/on
 */

// Re-export everything from the workflow events module
export {
  createOnProxy,
  matchHandlers,
  invokeHandlers,
  getEventTypes,
  getHandlerCount,
  clearHandlers,
  clearAllHandlers,
  type EventHandler,
  type OnProxy,
  type NounEventProxy,
  type RetryOptions,
  type HandlerResult,
  type InvokeHandlersResult,
} from './workflow/events'
