/**
 * Re-export proxy utilities from @dotdo/utils
 *
 * These utilities are shared across @dotdo/do, @dotdo/rpc, and rpc.do packages.
 * They are now centralized in @dotdo/utils to avoid cross-package relative imports.
 *
 * @module do/utils/proxy
 * @see @dotdo/utils/proxy for implementation details
 */

export {
  PROMISE_PROPS,
  createNestedProxy,
  createMethodProxy,
  createCallableNestedProxy,
  createDeepRPCProxy,
  createEventProxy,
  createScheduleProxy,
  createEntityAccessProxy,
  type DeepRPCProxyOptions,
  type EventProxyOptions,
  type ScheduleProxyOptions,
  type EntityProxyOptions,
} from '@dotdo/utils'
